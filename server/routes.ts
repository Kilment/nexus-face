import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import multer from "multer";
import crypto from "crypto";
import { storage } from "./storage";
import { getDeIdPipelineInfo } from "./face-processor";
import { deIdentifyWithFallback } from "./deid";
import { standardizePhoto } from "./photo-standardizer";
import { insertPhotoSchema } from "@shared/schema";
import { detectDemographics } from "./rekognition";
import { analyzeStudy } from "./study-analysis";
import { buildAllStudiesExportBundle, buildStudyExportBundle } from "./cohort-export";
import {
  aggregateByMetric,
  rankInterventions,
  type InterventionRow,
} from "./cohort-stats";
import { pairMetricsSchema } from "@shared/cohort-metrics";
import { z } from "zod";
import { importZipBufferForUser, ZipImportValidationError } from "./zipImportService";
import { runCohortAnalysisForLinkedPair } from "./cohort-linked-pair";

const ZIP_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

const importZipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ZIP_UPLOAD_MAX_BYTES },
}).single("zip");

function importZipUploadSafe(req: Request, res: Response, next: NextFunction) {
  importZipUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Zip file exceeds 1 GB limit" });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: "Invalid zip upload" });
    }
    next();
  });
}

/** Multipart (native) or raw zip bytes (web); JSON-only hits `next()` so `express.json` body stays. */
function importZipBodyParser(req: Request, res: Response, next: NextFunction) {
  const ct = (req.headers["content-type"] || "").toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    return importZipUploadSafe(req, res, next);
  }
  if (
    ct.startsWith("application/zip") ||
    (ct.startsWith("application/octet-stream") && !ct.includes("json"))
  ) {
    /** Default `express.raw()` only accepts `application/octet-stream`, so `application/zip` was skipped and the body was never read. */
    return express.raw({
      limit: "1gb",
      type: ["application/zip", "application/octet-stream"],
    })(req, res, next);
  }
  next();
}

type RequestWithZipFile = Request & { file?: Express.Multer.File };

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return hash === verifyHash;
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

interface ReplitUserInfo {
  id: string;
  name: string;
  profileImage?: string;
}

async function getReplitUserInfo(token: string): Promise<ReplitUserInfo | null> {
  try {
    const response = await fetch("https://replit.com/api/v0/auth/userinfo", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      id: data.sub,
      name: data.name || data.preferred_username || "User",
      profileImage: data.picture,
    };
  } catch {
    return null;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const headerUserId = req.header("X-User-Id");
  if (headerUserId) {
    req.session.userId = headerUserId;
  }
  
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const deIdMetrics = {
    total: 0,
    faceApi: 0,
    openAiFallback: 0,
  };

  type AnalysisState = "idle" | "running" | "complete" | "failed";
  type StudyAnalysisStatus = {
    state: AnalysisState;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    analysisCount: number;
  };
  const analysisStatusByStudy = new Map<string, StudyAnalysisStatus>();

  function getStudyAnalysisStatus(studyId: string): StudyAnalysisStatus {
    return (
      analysisStatusByStudy.get(studyId) ?? {
        state: "idle",
        startedAt: null,
        finishedAt: null,
        error: null,
        analysisCount: 0,
      }
    );
  }

  async function triggerStudyAnalysis(studyId: string, userId: string): Promise<StudyAnalysisStatus> {
    const current = getStudyAnalysisStatus(studyId);
    if (current.state === "running") {
      return current;
    }

    const startedAt = new Date().toISOString();
    analysisStatusByStudy.set(studyId, {
      state: "running",
      startedAt,
      finishedAt: null,
      error: null,
      analysisCount: current.analysisCount ?? 0,
    });

    void analyzeStudy(studyId, userId)
      .then((rows) => {
        analysisStatusByStudy.set(studyId, {
          state: "complete",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: null,
          analysisCount: rows.length,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Analysis Failed";
        console.error(`Background study analysis failed for ${studyId}:`, error);
        analysisStatusByStudy.set(studyId, {
          state: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: message,
          analysisCount: 0,
        });
      });

    return getStudyAnalysisStatus(studyId);
  }

  function logDeIdMethod(context: string, method: "FaceApi" | "OpenAIFallback", extra?: string) {
    deIdMetrics.total += 1;
    if (method === "FaceApi") {
      deIdMetrics.faceApi += 1;
    } else {
      deIdMetrics.openAiFallback += 1;
    }
    const fallbackRate =
      deIdMetrics.total > 0
        ? ((deIdMetrics.openAiFallback / deIdMetrics.total) * 100).toFixed(1)
        : "0.0";
    const suffix = extra ? ` | ${extra}` : "";
    console.log(
      `[DEID] ${context} | Method=${method} | Total=${deIdMetrics.total} | FaceApi=${deIdMetrics.faceApi} | OpenAIFallback=${deIdMetrics.openAiFallback} | FallbackRate=${fallbackRate}%${suffix}`,
    );
  }

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "nexus-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Sign up endpoint
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, username } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const passwordHash = hashPassword(password);
      const user = await storage.createUser({
        email,
        passwordHash,
        username: username || "Anonymous",
        profileImageUrl: null,
      });

      req.session.userId = user.id;
      res.json({ 
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        }
      });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ error: "Signup failed" });
    }
  });

  // Login endpoint
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (!verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      req.session.userId = user.id;
      res.json({ 
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Development login endpoint - for testing without Replit Auth (legacy)
  app.post("/api/auth/dev-login", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email required" });
      }

      let user = await storage.getUserByEmail(email);
      if (!user) {
        user = await storage.getUserByReplitId(email);
      }
      if (!user) {
        user = await storage.createUser({
          email,
          username: email.split("@")[0],
          profileImageUrl: null,
        });
      }

      req.session.userId = user.id;
      res.json({ user });
    } catch (error) {
      console.error("Dev login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/replit", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: "Token required" });
      }

      const userInfo = await getReplitUserInfo(token);
      if (!userInfo) {
        return res.status(401).json({ error: "Invalid token" });
      }

      let user = await storage.getUserByReplitId(userInfo.id);
      if (!user) {
        user = await storage.createUser({
          replitId: userInfo.id,
          username: userInfo.name,
          profileImageUrl: userInfo.profileImage,
        });
      }

      req.session.userId = user.id;
      res.json({ user });
    } catch (error) {
      console.error("Auth error:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    const headerUserId = req.header("X-User-Id");
    const userId = headerUserId || req.session.userId;
    
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    res.json({ user });
  });

  app.patch("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const { username: rawUsername, profileImageUrl: rawProfileImageUrl } = req.body as {
        username?: string;
        profileImageUrl?: string | null;
      };

      const updates: Partial<{
        username: string;
        profileImageUrl: string | null;
      }> = {};

      if (rawProfileImageUrl !== undefined) {
        if (rawProfileImageUrl === null || rawProfileImageUrl === "") {
          updates.profileImageUrl = null;
        } else if (
          typeof rawProfileImageUrl === "string" &&
          /^data:image\/(jpeg|jpg|png|webp);base64,/.test(rawProfileImageUrl)
        ) {
          if (rawProfileImageUrl.length > 2_500_000) {
            return res.status(400).json({ error: "Profile photo is too large. Try a smaller image." });
          }
          updates.profileImageUrl = rawProfileImageUrl;
        } else {
          return res.status(400).json({ error: "Invalid profile image format" });
        }
      }

      if (rawUsername !== undefined) {
        const username = typeof rawUsername === "string" ? rawUsername.trim() : "";
        if (username.length < 2) {
          return res.status(400).json({ error: "Username must be at least 2 characters" });
        }
        updates.username = username;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "Nothing to update" });
      }

      const updatedUser = await storage.updateUser(req.session.userId!, updates);
      res.json({ user: updatedUser });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/photos", requireAuth, async (req, res) => {
    try {
      const photos = await storage.getPhotosByUserId(req.session.userId!);
      res.json({ photos });
    } catch (error) {
      console.error("Error fetching photos:", error);
      res.status(500).json({ error: "Failed to fetch photos" });
    }
  });

  app.get("/api/photos/:id", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo not found" });
      }
      res.json({ photo });
    } catch (error) {
      console.error("Error fetching photo:", error);
      res.status(500).json({ error: "Failed to fetch photo" });
    }
  });

  app.post("/api/photos/process", requireAuth, async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "Image data required" });
      }

      const result = await deIdentifyWithFallback(imageBase64);
      logDeIdMethod(
        "SingleProcess",
        result.method,
        result.fallbackReason ? `FallbackReason=${result.fallbackReason}` : undefined,
      );
      res.json({
        processedImageBase64: result.processedImageBase64,
        deIdPipeline: getDeIdPipelineInfo(),
        deIdMethod: result.method,
        deIdFallbackReason: result.fallbackReason ?? null,
      });
    } catch (error) {
      console.error("Error processing image:", error);
      const message = error instanceof Error ? error.message : "Failed to process image";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/deid/pipeline", requireAuth, async (_req, res) => {
    const info = getDeIdPipelineInfo();
    if (!info) {
      return res.status(503).json({ error: "De-Identification Pipeline Not Loaded Yet" });
    }
    res.json({ deIdPipeline: info });
  });

  app.post("/api/photos", requireAuth, async (req, res) => {
    try {
      const { processedImageBase64, initials, beforeAfter, locationCode, weeksAfter } = req.body;
      
      if (!processedImageBase64 || !initials || !beforeAfter || !locationCode) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log("Standardizing photo for consistent lighting, sizing, and zoom...");
      const standardizedImageBase64 = await standardizePhoto(processedImageBase64);
      console.log("Photo standardization complete");

      const demographics = await detectDemographics(standardizedImageBase64);

      const photo = await storage.createPhoto({
        userId: req.session.userId!,
        processedImageUrl: `data:image/png;base64,${processedImageBase64}`,
        processedImageBase64,
        standardizedImageBase64,
        initials: initials.toUpperCase(),
        beforeAfter,
        locationCode,
        gender: demographics?.gender,
        ageRange: demographics?.ageRange,
        ethnicity: demographics?.ethnicity,
        weeksAfter: beforeAfter === "after" ? (weeksAfter ? parseInt(weeksAfter.toString()) : null) : null,
      });

      // Autolink logic
      const linkablePhotos = await storage.getLinkablePhotos(
        req.session.userId!,
        photo.initials,
        photo.beforeAfter,
        photo.id
      );

      if (linkablePhotos.length > 0) {
        // Sort by date to get the most recent one if multiple exist
        const targetPhoto = linkablePhotos.sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];

        await storage.updatePhotoLink(photo.id, targetPhoto.id);
        await storage.updatePhotoLink(targetPhoto.id, photo.id);

        await runCohortAnalysisForLinkedPair(
          req.session.userId!,
          photo,
          targetPhoto,
          triggerStudyAnalysis,
        );

        // Return updated photo with link info
        const updatedPhoto = await storage.getPhoto(photo.id);
        return res.json({ photo: updatedPhoto });
      }

      res.json({ photo });
    } catch (error) {
      console.error("Error saving photo:", error);
      res.status(500).json({ error: "Failed to save photo" });
    }
  });

  app.post("/api/photos/import-zip", requireAuth, importZipBodyParser, async (req, res) => {
    try {
      const reqWithFile = req as RequestWithZipFile;
      let zipBuffer: Buffer | undefined;
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        zipBuffer = req.body;
      } else if (reqWithFile.file?.buffer && reqWithFile.file.buffer.length > 0) {
        zipBuffer = reqWithFile.file.buffer;
      } else {
        const body = z
          .object({
            zipBase64: z.string().min(1, "zipBase64 is required and must be non-empty base64"),
          })
          .safeParse(req.body);

        if (!body.success) {
          return res.status(400).json({
            error: "Invalid Request Body",
            details: body.error.flatten(),
            hint:
              "Send raw zip (Content-Type: application/zip), multipart field \"zip\", or JSON { zipBase64 }.",
          });
        }
        zipBuffer = Buffer.from(body.data.zipBase64, "base64");
      }

      if (!zipBuffer?.length) {
        return res.status(400).json({ error: "Empty zip file" });
      }

      try {
        const result = await importZipBufferForUser({
          userId: req.session.userId!,
          zipBuffer,
          logDeIdMethod,
          scheduleStudyAnalysis: triggerStudyAnalysis,
        });
        return res.status(201).json({
          importedCount: result.importedCount,
          skippedCount: result.skippedCount,
          skipped: result.skipped,
        });
      } catch (e) {
        if (e instanceof ZipImportValidationError) {
          return res.status(e.statusCode).json({
            error: e.message,
            ...e.body,
          });
        }
        throw e;
      }
    } catch (error) {
      console.error("Error Importing Zip Photos:", error);
      return res.status(500).json({ error: "Failed To Import Zip Photos" });
    }
  });

  app.get("/api/photos/:id/linkable", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo not found" });
      }

      const linkablePhotos = await storage.getLinkablePhotos(
        req.session.userId!,
        photo.initials,
        photo.beforeAfter,
        photo.id
      );

      res.json({ photos: linkablePhotos });
    } catch (error) {
      console.error("Error fetching linkable photos:", error);
      res.status(500).json({ error: "Failed to fetch linkable photos" });
    }
  });

  app.post("/api/photos/:id/link", requireAuth, async (req, res) => {
    try {
      const { linkedPhotoId } = req.body;
      const photo = await storage.getPhoto(req.params.id);
      
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo not found" });
      }

      const updatedPhoto = await storage.updatePhotoLink(photo.id, linkedPhotoId);
      
      if (linkedPhotoId) {
        const linkedPhoto = await storage.getPhoto(linkedPhotoId);
        if (!linkedPhoto || linkedPhoto.userId !== req.session.userId) {
          return res.status(404).json({ error: "Linked photo not found" });
        }
        await storage.updatePhotoLink(linkedPhotoId, photo.id);
        await runCohortAnalysisForLinkedPair(
          req.session.userId!,
          photo,
          linkedPhoto,
          triggerStudyAnalysis,
        );
      }

      res.json({ photo: updatedPhoto });
    } catch (error) {
      console.error("Error linking photo:", error);
      res.status(500).json({ error: "Failed to link photo" });
    }
  });

  app.get("/api/photos/:id/pair-analysis", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo not found" });
      }
      if (!photo.linkedPhotoId) {
        return res.status(404).json({ error: "Photo is not linked" });
      }

      const analysis = await storage.getPairAnalysisForPair(
        req.session.userId!,
        photo.id,
        photo.linkedPhotoId,
      );
      if (!analysis) {
        const study = await storage.findStudyForPhotoPair(req.session.userId!, photo.id, photo.linkedPhotoId);
        if (study) {
          return res.status(202).json({
            error: "Pair Analysis Pending",
            studyId: study.id,
            analysisStatus: getStudyAnalysisStatus(study.id),
          });
        }
        return res.status(404).json({ error: "No pair analysis found" });
      }
      res.json({ analysis });
    } catch (error) {
      console.error("Error fetching pair analysis:", error);
      res.status(500).json({ error: "Failed to fetch pair analysis" });
    }
  });

  app.get("/api/photos/:id/pair-analysis-status", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo not found" });
      }
      if (!photo.linkedPhotoId) {
        return res.status(404).json({ error: "Photo is not linked" });
      }

      const study = await storage.findStudyForPhotoPair(req.session.userId!, photo.id, photo.linkedPhotoId);
      if (!study) {
        return res.json({
          linked: true,
          studyId: null,
          status: {
            state: "idle",
            startedAt: null,
            finishedAt: null,
            error: null,
            analysisCount: 0,
          },
          hasAnalysis: false,
        });
      }

      const analysis = await storage.getPairAnalysisForPair(req.session.userId!, photo.id, photo.linkedPhotoId);
      const status = getStudyAnalysisStatus(study.id);
      res.json({
        linked: true,
        studyId: study.id,
        status: status.state === "idle" && analysis ? { ...status, state: "complete" } : status,
        hasAnalysis: Boolean(analysis),
      });
    } catch (error) {
      console.error("Error fetching pair analysis status:", error);
      res.status(500).json({ error: "Failed to fetch pair analysis status" });
    }
  });

  app.post("/api/photos/:id/convert-to-study", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo Not Found" });
      }
      if (!photo.linkedPhotoId) {
        return res.status(400).json({ error: "Photo Is Not Linked" });
      }

      const linkedPhoto = await storage.getPhoto(photo.linkedPhotoId);
      if (!linkedPhoto || linkedPhoto.userId !== req.session.userId) {
        return res.status(404).json({ error: "Linked Photo Not Found" });
      }

      const beforePhoto = photo.beforeAfter === "before" ? photo : linkedPhoto;
      const afterPhoto = photo.beforeAfter === "after" ? photo : linkedPhoto;
      if (beforePhoto.beforeAfter !== "before" || afterPhoto.beforeAfter !== "after") {
        return res.status(400).json({ error: "Linked Photos Must Include One Before And One After" });
      }

      const existing = await storage.getPairAnalysisForPair(req.session.userId!, beforePhoto.id, afterPhoto.id);
      const existingStudyForPair = await storage.findStudyForPhotoPair(
        req.session.userId!,
        beforePhoto.id,
        afterPhoto.id,
      );

      const study =
        existingStudyForPair ??
        (existing ? await storage.getStudyForUser(existing.studyId, req.session.userId!) : undefined) ??
        (await storage.createStudy({
          userId: req.session.userId!,
          title: `${beforePhoto.initials} Cohort Study`,
        }));

      const existingMembers = await storage.getStudyPhotosWithPhotos(study.id);
      const mergedByPhotoId = new Map<
        string,
        {
          photoId: string;
          role: string;
          weeksAfter: number | null;
          interventionLabel: string | null;
          sortOrder: number;
        }
      >();

      existingMembers.forEach((member, idx) => {
        mergedByPhotoId.set(member.photo.id, {
          photoId: member.photo.id,
          role: member.studyPhoto.role,
          weeksAfter: member.studyPhoto.weeksAfter ?? member.photo.weeksAfter ?? null,
          interventionLabel: member.studyPhoto.interventionLabel ?? null,
          sortOrder: idx,
        });
      });

      mergedByPhotoId.set(beforePhoto.id, {
        photoId: beforePhoto.id,
        role: "before",
        weeksAfter: null,
        interventionLabel: null,
        sortOrder: mergedByPhotoId.get(beforePhoto.id)?.sortOrder ?? mergedByPhotoId.size,
      });

      mergedByPhotoId.set(afterPhoto.id, {
        photoId: afterPhoto.id,
        role: "after",
        weeksAfter: afterPhoto.weeksAfter ?? null,
        interventionLabel: mergedByPhotoId.get(afterPhoto.id)?.interventionLabel ?? null,
        sortOrder: mergedByPhotoId.get(afterPhoto.id)?.sortOrder ?? mergedByPhotoId.size,
      });

      const normalized = Array.from(mergedByPhotoId.values()).map((entry, idx) => ({
        ...entry,
        sortOrder: idx,
      }));

      await storage.replaceStudyMembers(study.id, normalized);

      await triggerStudyAnalysis(study.id, req.session.userId!);

      res.json({ study, analysisStatus: getStudyAnalysisStatus(study.id) });
    } catch (error) {
      console.error("Error Converting Pair To Study:", error);
      res.status(500).json({ error: "Failed To Convert Pair To Study" });
    }
  });

  app.delete("/api/photos/:id", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== req.session.userId) {
        return res.status(404).json({ error: "Photo not found" });
      }

      await storage.deletePhoto(photo.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting photo:", error);
      res.status(500).json({ error: "Failed to delete photo" });
    }
  });

  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getUserStats(req.session.userId!);
      res.json({ stats });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  /* --- Research cohort studies --- */

  app.post("/api/studies", requireAuth, async (req, res) => {
    try {
      const title = typeof req.body?.title === "string" ? req.body.title : null;
      const study = await storage.createStudy({
        userId: req.session.userId!,
        title,
      });
      res.json({ study });
    } catch (error) {
      console.error("Create study error:", error);
      res.status(500).json({ error: "Failed to create study" });
    }
  });

  app.get("/api/studies", requireAuth, async (req, res) => {
    try {
      const list = await storage.listStudies(req.session.userId!);
      res.json({ studies: list });
    } catch (error) {
      console.error("List studies error:", error);
      res.status(500).json({ error: "Failed to list studies" });
    }
  });

  app.get("/api/studies/:id", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, req.session.userId!);
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }
      const members = await storage.getStudyPhotosWithPhotos(req.params.id);
      const existingRows = await storage.getPairAnalysesForStudy(req.params.id);
      const status = getStudyAnalysisStatus(req.params.id);
      res.json({
        study,
        members,
        analysisStatus:
          status.state === "idle" && existingRows.length > 0
            ? { ...status, state: "complete", analysisCount: existingRows.length }
            : status,
      });
    } catch (error) {
      console.error("Get study error:", error);
      res.status(500).json({ error: "Failed to fetch study" });
    }
  });

  app.delete("/api/studies/:id", requireAuth, async (req, res) => {
    try {
      const ok = await storage.deleteStudyForUser(req.params.id, req.session.userId!);
      if (!ok) {
        return res.status(404).json({ error: "Study not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete study error:", error);
      res.status(500).json({ error: "Failed to delete study" });
    }
  });

  const memberEntrySchema = z.object({
    photoId: z.string().min(1),
    role: z.enum(["before", "after"]),
    weeksAfter: z.number().int().nullable().optional(),
    interventionLabel: z.string().nullable().optional(),
    sortOrder: z.number().int(),
  });

  app.put("/api/studies/:id/members", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, req.session.userId!);
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }

      const parsed = z
        .object({
          entries: z.array(memberEntrySchema).min(1),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }

      const userId = req.session.userId!;
      for (const e of parsed.data.entries) {
        const photo = await storage.getPhoto(e.photoId);
        if (!photo || photo.userId !== userId) {
          return res.status(400).json({ error: `Photo not found or access denied: ${e.photoId}` });
        }
      }

      const beforeCount = parsed.data.entries.filter((e) => e.role === "before").length;
      if (beforeCount !== 1) {
        return res.status(400).json({ error: "Exactly one photo must have role \"before\"" });
      }

      await storage.replaceStudyMembers(
        req.params.id,
        parsed.data.entries.map((e) => ({
          photoId: e.photoId,
          role: e.role,
          weeksAfter: e.weeksAfter ?? null,
          interventionLabel: e.interventionLabel ?? null,
          sortOrder: e.sortOrder,
        })),
      );

      const members = await storage.getStudyPhotosWithPhotos(req.params.id);
      res.json({ study, members });
    } catch (error) {
      console.error("Replace study members error:", error);
      res.status(500).json({ error: "Failed to update study members" });
    }
  });

  const batchItemSchema = z.object({
    processedImageBase64: z.string(),
    initials: z.string().min(1).max(3),
    beforeAfter: z.enum(["before", "after"]),
    locationCode: z.string().min(1).max(50),
    weeksAfter: z.number().int().nullable().optional(),
    interventionLabel: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
  });

  app.post("/api/studies/batch", requireAuth, async (req, res) => {
    try {
      const parsed = z
        .object({
          title: z.string().nullable().optional(),
          items: z.array(batchItemSchema).min(2),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }

      const beforeCount = parsed.data.items.filter((i) => i.beforeAfter === "before").length;
      if (beforeCount !== 1) {
        return res.status(400).json({ error: "Exactly one item must have beforeAfter \"before\"" });
      }

      const userId = req.session.userId!;
      const study = await storage.createStudy({
        userId,
        title: parsed.data.title ?? null,
      });

      const memberEntries: Array<{
        photoId: string;
        role: string;
        weeksAfter?: number | null;
        interventionLabel?: string | null;
        sortOrder: number;
      }> = [];

      for (let idx = 0; idx < parsed.data.items.length; idx++) {
        const item = parsed.data.items[idx]!;
        const standardizedImageBase64 = await standardizePhoto(item.processedImageBase64);
        const demographics = await detectDemographics(standardizedImageBase64);

        const photo = await storage.createPhoto({
          userId,
          processedImageUrl: `data:image/png;base64,${item.processedImageBase64}`,
          processedImageBase64: item.processedImageBase64,
          standardizedImageBase64,
          initials: item.initials.toUpperCase(),
          beforeAfter: item.beforeAfter,
          locationCode: item.locationCode,
          gender: demographics?.gender,
          ageRange: demographics?.ageRange,
          ethnicity: demographics?.ethnicity,
          weeksAfter:
            item.beforeAfter === "after"
              ? item.weeksAfter ?? null
              : null,
        });

        memberEntries.push({
          photoId: photo.id,
          role: item.beforeAfter === "before" ? "before" : "after",
          weeksAfter: item.beforeAfter === "after" ? item.weeksAfter ?? null : null,
          interventionLabel: item.beforeAfter === "after" ? item.interventionLabel ?? null : null,
          sortOrder: item.sortOrder ?? idx,
        });
      }

      await storage.replaceStudyMembers(study.id, memberEntries);
      const members = await storage.getStudyPhotosWithPhotos(study.id);

      res.status(201).json({ study, members });
    } catch (error) {
      console.error("Study batch error:", error);
      res.status(500).json({ error: "Failed to create study batch" });
    }
  });

  app.post("/api/studies/:id/analyze", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, req.session.userId!);
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }

      const status = await triggerStudyAnalysis(req.params.id, req.session.userId!);
      res.status(202).json({
        accepted: true,
        analysisStatus: status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      console.error("Study analyze error:", error);
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/studies/:id/analysis-status", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, req.session.userId!);
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }
      const rows = await storage.getPairAnalysesForStudy(req.params.id);
      const status = getStudyAnalysisStatus(req.params.id);
      res.json({
        studyId: req.params.id,
        analysisStatus:
          status.state === "idle" && rows.length > 0
            ? { ...status, state: "complete", analysisCount: rows.length }
            : status,
      });
    } catch (error) {
      console.error("Get analysis status error:", error);
      res.status(500).json({ error: "Failed to fetch analysis status" });
    }
  });

  app.get("/api/studies/:id/analysis", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, req.session.userId!);
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }

      const rows = await storage.getPairAnalysesForStudy(req.params.id);
      res.json({ study, analyses: rows });
    } catch (error) {
      console.error("Get analysis error:", error);
      res.status(500).json({ error: "Failed to fetch analyses" });
    }
  });

  app.get("/api/studies/:id/cohort-stats", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, req.session.userId!);
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }

      const analyses = await storage.getPairAnalysesForStudy(req.params.id);
      const interventionRows: InterventionRow[] = [];

      for (const a of analyses) {
        const meta = await storage.getStudyMemberByPhoto(req.params.id, a.afterPhotoId);
        const metricsParse = pairMetricsSchema.safeParse(a.metrics);
        if (!metricsParse.success) continue;

        interventionRows.push({
          afterPhotoId: a.afterPhotoId,
          interventionLabel: meta?.interventionLabel ?? null,
          weeksAfter: meta?.weeksAfter ?? null,
          metrics: metricsParse.data,
        });
      }

      const aggregates = aggregateByMetric(interventionRows);
      const rankings = rankInterventions(interventionRows);

      res.json({
        study,
        sampleSize: interventionRows.length,
        aggregates,
        interventionRankings: rankings,
        pairs: interventionRows,
      });
    } catch (error) {
      console.error("Cohort stats error:", error);
      res.status(500).json({ error: "Failed to compute cohort stats" });
    }
  });

  app.get("/api/studies/:id/export-bundle", requireAuth, async (req, res) => {
    try {
      const bundle = await buildStudyExportBundle(req.session.userId!, req.params.id);
      const filename = `cohort-study-${req.params.id.slice(0, 8)}.json`;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(JSON.stringify(bundle, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      if (message === "Study not found") {
        return res.status(404).json({ error: message });
      }
      console.error("Study export bundle error:", error);
      res.status(500).json({ error: "Failed to export study bundle" });
    }
  });

  app.get("/api/export/cohort-studies-bundle", requireAuth, async (req, res) => {
    try {
      const bundle = await buildAllStudiesExportBundle(req.session.userId!);
      const filename = `cohort-studies-all-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(JSON.stringify(bundle, null, 2));
    } catch (error) {
      console.error("All cohort studies export error:", error);
      res.status(500).json({ error: "Failed to export cohort studies bundle" });
    }
  });

  app.get("/api/export/photos-cohort", requireAuth, async (req, res) => {
    try {
      const photoList = await storage.getPhotosByUserId(req.session.userId!);
      const lines = [
        [
          "photo_id",
          "initials",
          "before_after",
          "weeks_after",
          "location_code",
          "linked_photo_id",
          "has_standardized_base64",
        ].join(","),
      ];

      for (const p of photoList) {
        lines.push(
          [
            p.id,
            JSON.stringify(p.initials),
            p.beforeAfter,
            p.weeksAfter ?? "",
            JSON.stringify(p.locationCode),
            p.linkedPhotoId ?? "",
            p.standardizedImageBase64 ? "yes" : "no",
          ].join(","),
        );
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=\"photos_cohort_export.csv\"");
      res.send(lines.join("\n"));
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Export failed" });
    }
  });

  const httpServer = createServer(app);
  /** Default Node request timeout (~5 min) can abort large zip uploads mid-stream → raw-body "request aborted". */
  httpServer.requestTimeout = 0;
  return httpServer;
}
