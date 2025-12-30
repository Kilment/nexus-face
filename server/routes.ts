import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import session from "express-session";
import { storage } from "./storage";
import { processImageForFaceAnonymization } from "./face-processor";
import { insertPhotoSchema } from "@shared/schema";
import { calculateImprovementScore } from "./rekognition";

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

  // Development login endpoint - for testing without Replit Auth
  app.post("/api/auth/dev-login", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email required" });
      }

      let user = await storage.getUserByReplitId(email);
      if (!user) {
        user = await storage.createUser({
          replitId: email,
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
      const { processedImageBase64, initials, beforeAfter, locationCode } = req.body;
      
      if (!processedImageBase64 || !initials || !beforeAfter || !locationCode) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const photo = await storage.createPhoto({
        userId: req.session.userId!,
        processedImageUrl: `data:image/png;base64,${processedImageBase64}`,
        processedImageBase64,
        initials: initials.toUpperCase(),
        beforeAfter,
        locationCode,
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
        if (photo.beforeAfter === "after" && targetPhoto.beforeAfter === "before") {
          const result = await calculateImprovementScore(
            targetPhoto.processedImageBase64 || "",
            photo.processedImageBase64 || ""
          );
          await storage.updatePhotoLink(photo.id, targetPhoto.id, result.score);
        } else if (photo.beforeAfter === "before" && targetPhoto.beforeAfter === "after") {
          const result = await calculateImprovementScore(
            photo.processedImageBase64 || "",
            targetPhoto.processedImageBase64 || ""
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

  const httpServer = createServer(app);
  return httpServer;
}
