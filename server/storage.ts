import { users, photos, type User, type InsertUser, type Photo, type InsertPhoto } from "@shared/schema";
import { db } from "./db";
import { eq, and, ne, isNotNull, sql } from "drizzle-orm";

export interface UserStats {
  totalPhotos: number;
  linkedPairs: number;
  averageImprovement: number;
  bestImprovement: number;
  worstImprovement: number;
  recentPairs: Array<{
    beforePhoto: Photo;
    afterPhoto: Photo;
    improvementScore: number;
    percentage: number;
    confidenceLow: number;
    confidenceHigh: number;
  }>;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByReplitId(replitId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getPhoto(id: string): Promise<Photo | undefined>;
  getPhotosByUserId(userId: string): Promise<Photo[]>;
  createPhoto(photo: InsertPhoto): Promise<Photo>;
  updatePhotoLink(photoId: string, linkedPhotoId: string | null, improvementScore?: number): Promise<Photo | undefined>;
  deletePhoto(id: string): Promise<void>;
  getLinkablePhotos(userId: string, initials: string, beforeAfter: string, excludeId: string): Promise<Photo[]>;
  getUserStats(userId: string): Promise<UserStats>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByReplitId(replitId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.replitId, replitId));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getPhoto(id: string): Promise<Photo | undefined> {
    const [photo] = await db.select().from(photos).where(eq(photos.id, id));
    return photo || undefined;
  }

  async updateUser(id: string, update: Partial<Omit<User, "id">>): Promise<User> {
    const [user] = await db
      .update(users)
      .set(update)
      .where(eq(users.id, id))
      .returning();
    if (!user) throw new Error("User not found");
    return user;
  }

  async getPhotosByUserId(userId: string): Promise<Photo[]> {
    return await db.select().from(photos).where(eq(photos.userId, userId)).orderBy(photos.createdAt);
  }

  async createPhoto(insertPhoto: InsertPhoto): Promise<Photo> {
    const [photo] = await db
      .insert(photos)
      .values(insertPhoto)
      .returning();
    return photo;
  }

  async updatePhotoLink(photoId: string, linkedPhotoId: string | null, improvementScore?: number): Promise<Photo | undefined> {
    const [photo] = await db
      .update(photos)
      .set({ linkedPhotoId, improvementScore: improvementScore ?? null })
      .where(eq(photos.id, photoId))
      .returning();
    return photo || undefined;
  }

  async deletePhoto(id: string): Promise<void> {
    await db.update(photos).set({ linkedPhotoId: null }).where(eq(photos.linkedPhotoId, id));
    await db.delete(photos).where(eq(photos.id, id));
  }

  async getLinkablePhotos(userId: string, initials: string, beforeAfter: string, excludeId: string): Promise<Photo[]> {
    const oppositeType = beforeAfter === "before" ? "after" : "before";
    return await db
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.userId, userId),
          eq(photos.initials, initials),
          eq(photos.beforeAfter, oppositeType),
          ne(photos.id, excludeId)
        )
      );
  }

  async getUserStats(userId: string): Promise<UserStats> {
    const allPhotos = await db.select().from(photos).where(eq(photos.userId, userId));
    
    const afterPhotosWithScores = allPhotos.filter(
      (p) => p.beforeAfter === "after" && p.linkedPhotoId && p.improvementScore !== null
    );
    
    const scores = afterPhotosWithScores.map((p) => p.improvementScore!);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 50;
    const bestScore = scores.length > 0 ? Math.max(...scores) : 50;
    const worstScore = scores.length > 0 ? Math.min(...scores) : 50;

    const scoreToPercentage = (score: number) => {
      if (score <= 0) return 0;
      return Math.round(Math.log(score / 50) * 144.27);
    };

    const recentPairs: UserStats["recentPairs"] = [];
    
    const sortedAfterPhotos = afterPhotosWithScores
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
    
    for (const afterPhoto of sortedAfterPhotos) {
      const beforePhoto = allPhotos.find((p) => p.id === afterPhoto.linkedPhotoId);
      if (beforePhoto && afterPhoto.improvementScore !== null) {
        const percentage = scoreToPercentage(afterPhoto.improvementScore);
        const margin = Math.max(2, Math.round(5));
        recentPairs.push({
          beforePhoto,
          afterPhoto,
          improvementScore: afterPhoto.improvementScore,
          percentage,
          confidenceLow: percentage - margin,
          confidenceHigh: percentage + margin,
        });
      }
    }

    return {
      totalPhotos: allPhotos.length,
      linkedPairs: afterPhotosWithScores.length,
      averageImprovement: scoreToPercentage(averageScore),
      bestImprovement: scoreToPercentage(bestScore),
      worstImprovement: scoreToPercentage(worstScore),
      recentPairs,
    };
  }
}

export const storage = new DatabaseStorage();
