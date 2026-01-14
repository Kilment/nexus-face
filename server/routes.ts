import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import crypto from "crypto";
import { storage } from "./storage";
import { processImageForFaceAnonymization } from "./face-processor";
import { standardizePhoto } from "./photo-standardizer";
import { insertPhotoSchema } from "@shared/schema";
import { calculateImprovementScore, detectDemographics } from "./rekognition";

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
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "facesnap-secret-key",
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
      const { username } = req.body;
      if (!username || username.length < 2) {
        return res.status(400).json({ error: "Username must be at least 2 characters" });
      }

      const updatedUser = await storage.updateUser(req.session.userId!, { username });
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

      const processedBase64 = await processImageForFaceAnonymization(imageBase64);
      res.json({ processedImageBase64: processedBase64 });
    } catch (error) {
      console.error("Error processing image:", error);
      res.status(500).json({ error: "Failed to process image" });
    }
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
        
        // Calculate improvement score if this is an "after" photo linking to a "before" photo
        // Use standardized images for consistent Rekognition analysis
        if (photo.beforeAfter === "after" && targetPhoto.beforeAfter === "before") {
          const result = await calculateImprovementScore(
            targetPhoto.standardizedImageBase64 || targetPhoto.processedImageBase64 || "",
            photo.standardizedImageBase64 || photo.processedImageBase64 || ""
          );
          await storage.updatePhotoLink(photo.id, targetPhoto.id, result.score);
        } else if (photo.beforeAfter === "before" && targetPhoto.beforeAfter === "after") {
          const result = await calculateImprovementScore(
            photo.standardizedImageBase64 || photo.processedImageBase64 || "",
            targetPhoto.standardizedImageBase64 || targetPhoto.processedImageBase64 || ""
          );
          await storage.updatePhotoLink(targetPhoto.id, photo.id, result.score);
        }

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
        await storage.updatePhotoLink(linkedPhotoId, photo.id);
      }

      res.json({ photo: updatedPhoto });
    } catch (error) {
      console.error("Error linking photo:", error);
      res.status(500).json({ error: "Failed to link photo" });
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

  const httpServer = createServer(app);
  return httpServer;
}
