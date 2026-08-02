import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import crypto from "crypto";
import { storage } from "./storage";
import {
  requireAuth,
  currentUserId,
  createSession,
  revokeSession,
  revokeAllSessionsForUser,
} from "./auth";
import { verifyAppleIdentityToken } from "./apple-auth";
import { getDeIdPipelineInfo } from "./face-processor";
import { deIdentifyWithFallback } from "./deid";
import { standardizePhoto } from "./photo-standardizer";
import { insertPhotoSchema } from "@shared/schema";
import { detectDemographics } from "./rekognition";
import { analyzeStudy } from "./study-analysis";
import { loadCohortReference } from "./cohort-reference";
import { getVisionModelId } from "./vision-rubric";
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

export async function registerRoutes(app: Express): Promise<Server> {
  const deIdMetrics = {
    total: 0,
    faceApi: 0,
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
      .then((result) => {
        // Pairs that could not be scored are surfaced, not silently dropped:
        // a study reporting "complete" with fewer rows than photos would
        // otherwise look like a full result set.
        const failureNote = result.failures.length
          ? `${result.failures.length} pair(s) could not be scored: ` +
            result.failures.map((f) => `${f.afterPhotoId.slice(0, 8)}: ${f.reason}`).join(" | ")
          : null;
        analysisStatusByStudy.set(studyId, {
          state: "complete",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: failureNote ?? result.scoringNotice,
          analysisCount: result.rows.length,
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

  function logDeIdMethod(context: string, method: "FaceApi") {
    deIdMetrics.total += 1;
    deIdMetrics.faceApi += 1;
    console.log(
      `[DEID] ${context} | Method=${method} | Total=${deIdMetrics.total} | FaceApi=${deIdMetrics.faceApi}`,
    );
  }

  /**
   * Sign in with Apple.
   *
   * The client's identityToken is verified against Apple's published keys
   * before anything is trusted; issuer, audience and expiry are all enforced.
   * On success the server issues its own random bearer token.
   *
   * This replaces password login, an ungated `dev-login` that minted a session
   * for any email supplied, and Replit Auth — none of which are viable for a
   * shipped application holding patient data.
   */
  app.post("/api/auth/apple", async (req, res) => {
    try {
      const { identityToken, fullName } = req.body as {
        identityToken?: string;
        fullName?: { givenName?: string | null; familyName?: string | null } | null;
      };

      if (!identityToken || typeof identityToken !== "string") {
        return res.status(400).json({ error: "identityToken is required" });
      }

      let identity;
      try {
        identity = await verifyAppleIdentityToken(identityToken);
      } catch (error) {
        console.warn("Apple identity token rejected:", error);
        return res.status(401).json({ error: "Invalid Apple identity token" });
      }

      let user = await storage.getUserByAppleSub(identity.sub);

      if (!user && identity.email) {
        // Link a pre-existing account on first Apple sign-in.
        const byEmail = await storage.getUserByEmail(identity.email);
        if (byEmail) {
          user = await storage.updateUser(byEmail.id, { appleSub: identity.sub });
        }
      }

      if (!user) {
        // Apple only sends the name on the very first authorization, so use it
        // when offered and fall back to something neutral otherwise.
        const given = fullName?.givenName?.trim() ?? "";
        const family = fullName?.familyName?.trim() ?? "";
        const displayName = [given, family].filter(Boolean).join(" ");
        user = await storage.createUser({
          appleSub: identity.sub,
          email: identity.email,
          username: displayName || identity.email?.split("@")[0] || "Nexus User",
          profileImageUrl: null,
        });
      }

      const { token, expiresAt } = await createSession(user.id, req.header("user-agent"));
      res.json({
        token,
        expiresAt: expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          profileImageUrl: user.profileImageUrl,
        },
      });
    } catch (error) {
      console.error("Apple sign-in error:", error);
      res.status(500).json({ error: "Sign-in failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const u = req.user!;
    res.json({
      user: {
        id: u.id,
        email: u.email,
        username: u.username,
        profileImageUrl: u.profileImageUrl,
      },
    });
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      await revokeSession(req.authToken!);
      res.json({ success: true });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  /**
   * Permanent account deletion. Apple requires this to be reachable in-app for
   * any application that supports account creation.
   *
   * Cascades to photos, studies and analyses via foreign keys, so every stored
   * image is destroyed with the account.
   */
  app.delete("/api/auth/account", requireAuth, async (req, res) => {
    try {
      const userId = currentUserId(req);
      await revokeAllSessionsForUser(userId);
      await storage.deleteUser(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Account deletion error:", error);
      res.status(500).json({ error: "Account deletion failed" });
    }
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

      const updatedUser = await storage.updateUser(currentUserId(req), updates);
      res.json({ user: updatedUser });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/photos", requireAuth, async (req, res) => {
    try {
      const photos = await storage.getPhotosByUserId(currentUserId(req));
      res.json({ photos });
    } catch (error) {
      console.error("Error fetching photos:", error);
      res.status(500).json({ error: "Failed to fetch photos" });
    }
  });

  app.get("/api/photos/:id", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== currentUserId(req)) {
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
      logDeIdMethod("SingleProcess", result.method);
      res.json({
        processedImageBase64: result.processedImageBase64,
        deIdPipeline: getDeIdPipelineInfo(),
        deIdMethod: result.method,
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
        userId: currentUserId(req),
        processedImageUrl: `data:image/png;base64,${processedImageBase64}`,
        processedImageBase64,
        standardizedImageBase64,
        initials: initials.toUpperCase(),
        beforeAfter,
        locationCode,
        gender: demographics.gender,
        ageRange: demographics.ageRange,
        weeksAfter: beforeAfter === "after" ? (weeksAfter ? parseInt(weeksAfter.toString()) : null) : null,
      });

      // Autolink logic
      const linkablePhotos = await storage.getLinkablePhotos(
        currentUserId(req),
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
          currentUserId(req),
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
          userId: currentUserId(req),
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
      if (!photo || photo.userId !== currentUserId(req)) {
        return res.status(404).json({ error: "Photo not found" });
      }

      const linkablePhotos = await storage.getLinkablePhotos(
        currentUserId(req),
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
      
      if (!photo || photo.userId !== currentUserId(req)) {
        return res.status(404).json({ error: "Photo not found" });
      }

      const updatedPhoto = await storage.updatePhotoLink(photo.id, linkedPhotoId);
      
      if (linkedPhotoId) {
        const linkedPhoto = await storage.getPhoto(linkedPhotoId);
        if (!linkedPhoto || linkedPhoto.userId !== currentUserId(req)) {
          return res.status(404).json({ error: "Linked photo not found" });
        }
        await storage.updatePhotoLink(linkedPhotoId, photo.id);
        await runCohortAnalysisForLinkedPair(
          currentUserId(req),
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
      if (!photo || photo.userId !== currentUserId(req)) {
        return res.status(404).json({ error: "Photo not found" });
      }
      if (!photo.linkedPhotoId) {
        return res.status(404).json({ error: "Photo is not linked" });
      }

      const analysis = await storage.getPairAnalysisForPair(
        currentUserId(req),
        photo.id,
        photo.linkedPhotoId,
      );
      if (!analysis) {
        const study = await storage.findStudyForPhotoPair(currentUserId(req), photo.id, photo.linkedPhotoId);
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
      if (!photo || photo.userId !== currentUserId(req)) {
        return res.status(404).json({ error: "Photo not found" });
      }
      if (!photo.linkedPhotoId) {
        return res.status(404).json({ error: "Photo is not linked" });
      }

      const study = await storage.findStudyForPhotoPair(currentUserId(req), photo.id, photo.linkedPhotoId);
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

      const analysis = await storage.getPairAnalysisForPair(currentUserId(req), photo.id, photo.linkedPhotoId);
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
      if (!photo || photo.userId !== currentUserId(req)) {
        return res.status(404).json({ error: "Photo Not Found" });
      }
      if (!photo.linkedPhotoId) {
        return res.status(400).json({ error: "Photo Is Not Linked" });
      }

      const linkedPhoto = await storage.getPhoto(photo.linkedPhotoId);
      if (!linkedPhoto || linkedPhoto.userId !== currentUserId(req)) {
        return res.status(404).json({ error: "Linked Photo Not Found" });
      }

      const beforePhoto = photo.beforeAfter === "before" ? photo : linkedPhoto;
      const afterPhoto = photo.beforeAfter === "after" ? photo : linkedPhoto;
      if (beforePhoto.beforeAfter !== "before" || afterPhoto.beforeAfter !== "after") {
        return res.status(400).json({ error: "Linked Photos Must Include One Before And One After" });
      }

      const existing = await storage.getPairAnalysisForPair(currentUserId(req), beforePhoto.id, afterPhoto.id);
      const existingStudyForPair = await storage.findStudyForPhotoPair(
        currentUserId(req),
        beforePhoto.id,
        afterPhoto.id,
      );

      const study =
        existingStudyForPair ??
        (existing ? await storage.getStudyForUser(existing.studyId, currentUserId(req)) : undefined) ??
        (await storage.createStudy({
          userId: currentUserId(req),
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

      await triggerStudyAnalysis(study.id, currentUserId(req));

      res.json({ study, analysisStatus: getStudyAnalysisStatus(study.id) });
    } catch (error) {
      console.error("Error Converting Pair To Study:", error);
      res.status(500).json({ error: "Failed To Convert Pair To Study" });
    }
  });

  app.delete("/api/photos/:id", requireAuth, async (req, res) => {
    try {
      const photo = await storage.getPhoto(req.params.id);
      if (!photo || photo.userId !== currentUserId(req)) {
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
      const stats = await storage.getUserStats(currentUserId(req));
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
        userId: currentUserId(req),
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
      const list = await storage.listStudies(currentUserId(req));
      res.json({ studies: list });
    } catch (error) {
      console.error("List studies error:", error);
      res.status(500).json({ error: "Failed to list studies" });
    }
  });

  app.get("/api/studies/:id", requireAuth, async (req, res) => {
    try {
      const study = await storage.getStudyForUser(req.params.id, currentUserId(req));
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
      const ok = await storage.deleteStudyForUser(req.params.id, currentUserId(req));
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
      const study = await storage.getStudyForUser(req.params.id, currentUserId(req));
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

      const userId = currentUserId(req);
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

      const userId = currentUserId(req);
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
          gender: demographics.gender,
          ageRange: demographics.ageRange,
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
      const study = await storage.getStudyForUser(req.params.id, currentUserId(req));
      if (!study) {
        return res.status(404).json({ error: "Study not found" });
      }

      const status = await triggerStudyAnalysis(req.params.id, currentUserId(req));
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
      const study = await storage.getStudyForUser(req.params.id, currentUserId(req));
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
      const study = await storage.getStudyForUser(req.params.id, currentUserId(req));
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
      const study = await storage.getStudyForUser(req.params.id, currentUserId(req));
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

      const { reference, loadError } = loadCohortReference();
      const aggregates = aggregateByMetric(interventionRows);
      const rankings = rankInterventions(interventionRows, reference, getVisionModelId());

      res.json({
        study,
        sampleSize: interventionRows.length,
        aggregates,
        interventionRankings: rankings,
        scoringBasis: reference
          ? {
              referenceVersion: reference.referenceVersion,
              sampleSize: reference.sampleSize,
              rubricVersion: reference.rubricVersion,
              preprocessingVersion: reference.preprocessingVersion,
              modelId: reference.modelId,
            }
          : null,
        scoringNotice: reference ? null : loadError,
        pairs: interventionRows,
      });
    } catch (error) {
      console.error("Cohort stats error:", error);
      res.status(500).json({ error: "Failed to compute cohort stats" });
    }
  });

  app.get("/api/studies/:id/export-bundle", requireAuth, async (req, res) => {
    try {
      const bundle = await buildStudyExportBundle(currentUserId(req), req.params.id);
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
      const bundle = await buildAllStudiesExportBundle(currentUserId(req));
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
      const photoList = await storage.getPhotosByUserId(currentUserId(req));
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
