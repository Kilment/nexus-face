import { users, photos, type User, type InsertUser, type Photo, type InsertPhoto } from "@shared/schema";
import { db } from "./db";
import { eq, and, ne } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByReplitId(replitId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getPhoto(id: string): Promise<Photo | undefined>;
  getPhotosByUserId(userId: string): Promise<Photo[]>;
  createPhoto(photo: InsertPhoto): Promise<Photo>;
  updatePhotoLink(photoId: string, linkedPhotoId: string | null): Promise<Photo | undefined>;
  deletePhoto(id: string): Promise<void>;
  getLinkablePhotos(userId: string, initials: string, beforeAfter: string, excludeId: string): Promise<Photo[]>;
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

  async updatePhotoLink(photoId: string, linkedPhotoId: string | null): Promise<Photo | undefined> {
    const [photo] = await db
      .update(photos)
      .set({ linkedPhotoId })
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
}

export const storage = new DatabaseStorage();
