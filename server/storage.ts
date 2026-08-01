import {
  users,
  photos,
  studies,
  studyPhotos,
  pairAnalysis,
  type User,
  type InsertUser,
  type Photo,
  type InsertPhoto,
  type Study,
  type InsertStudy,
  type StudyPhoto,
  type InsertStudyPhoto,
  type PairAnalysisRow,
  type InsertPairAnalysis,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, ne, sql, asc, or, desc } from "drizzle-orm";
import { pairMetricsSchema, type PairMetrics } from "@shared/cohort-metrics";

export interface UserStats {
  totalPhotos: number;
  linkedPairs: number;
  /** Null when no pair contributed a value — renders as N/A, never as 0. */
  averageDeltaPredictedAge: number | null;
  averageDeltaWrinkles: number | null;
  averagePerceivedFirmnessDelta: number | null;
  recentPairs: Array<{
    beforePhoto: Photo;
    afterPhoto: Photo;
    metrics: PairMetrics;
    studyId: string | null;
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
  updatePhotoLink(photoId: string, linkedPhotoId: string | null): Promise<Photo | undefined>;
  deletePhoto(id: string): Promise<void>;
  getLinkablePhotos(userId: string, initials: string, beforeAfter: string, excludeId: string): Promise<Photo[]>;
  getUserStats(userId: string): Promise<UserStats>;

  createStudy(insert: InsertStudy): Promise<Study>;
  listStudies(userId: string): Promise<Study[]>;
  getStudyForUser(studyId: string, userId: string): Promise<Study | undefined>;
  deleteStudyForUser(studyId: string, userId: string): Promise<boolean>;
  replaceStudyMembers(
    studyId: string,
    entries: Array<{
      photoId: string;
      role: string;
      weeksAfter?: number | null;
      interventionLabel?: string | null;
      sortOrder: number;
    }>,
  ): Promise<void>;
  getStudyPhotosWithPhotos(
    studyId: string,
  ): Promise<Array<{ studyPhoto: StudyPhoto; photo: Photo }>>;
  createPairAnalysis(insert: InsertPairAnalysis): Promise<PairAnalysisRow>;
  deletePairAnalysesForStudy(studyId: string): Promise<void>;
  getPairAnalysesForStudy(studyId: string): Promise<PairAnalysisRow[]>;
  getStudyMemberByPhoto(studyId: string, photoId: string): Promise<StudyPhoto | undefined>;
  getPairAnalysisForAfterPhoto(userId: string, afterPhotoId: string): Promise<PairAnalysisRow | undefined>;
  getPairAnalysisForPair(userId: string, photoAId: string, photoBId: string): Promise<PairAnalysisRow | undefined>;
  findStudyForPhotoPair(userId: string, photoAId: string, photoBId: string): Promise<Study | undefined>;
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

  async getUserStats(userId: string): Promise<UserStats> {
    const allPhotos = await db.select().from(photos).where(eq(photos.userId, userId));
    const recentPairs: UserStats["recentPairs"] = [];

    const linkedAfterPhotos = allPhotos.filter(
      (p) => p.beforeAfter === "after" && p.linkedPhotoId,
    );

    const sortedAfterPhotos = linkedAfterPhotos
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    const metricRows: PairMetrics[] = [];

    for (const afterPhoto of sortedAfterPhotos) {
      const beforePhoto = allPhotos.find((p) => p.id === afterPhoto.linkedPhotoId);
      if (beforePhoto) {
        const analysis = await this.getPairAnalysisForAfterPhoto(userId, afterPhoto.id);
        if (!analysis) continue;
        const parsed = pairMetricsSchema.safeParse(analysis.metrics);
        if (!parsed.success) continue;
        metricRows.push(parsed.data);
        const cohort = await this.findStudyForPhotoPair(userId, beforePhoto.id, afterPhoto.id);
        recentPairs.push({
          beforePhoto,
          afterPhoto,
          metrics: parsed.data,
          studyId: cohort?.id ?? null,
        });
      }
    }

    const linkedCount = metricRows.length;

    // Null, not 0, when nothing contributed: a 0 average reads as "measured, no
    // change" when the truth is "nothing to measure". Pairs whose value is N/A
    // are excluded from the denominator rather than counted as zero.
    const avg = (selector: (m: PairMetrics) => number | null): number | null => {
      const values = metricRows
        .map(selector)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      if (values.length === 0) return null;
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    };

    return {
      totalPhotos: allPhotos.length,
      linkedPairs: linkedCount,
      averageDeltaPredictedAge: avg((m) => m.deltaPredictedFacialAge),
      averageDeltaWrinkles: avg((m) => m.deltaWrinkles),
      averagePerceivedFirmnessDelta: avg((m) => m.perceivedSkinFirmnessDelta),
      recentPairs,
    };
  }

  async createStudy(insert: InsertStudy): Promise<Study> {
    const [row] = await db.insert(studies).values(insert).returning();
    return row!;
  }

  async listStudies(userId: string): Promise<Study[]> {
    return db.select().from(studies).where(eq(studies.userId, userId)).orderBy(asc(studies.createdAt));
  }

  async getStudyForUser(studyId: string, userId: string): Promise<Study | undefined> {
    const [row] = await db
      .select()
      .from(studies)
      .where(and(eq(studies.id, studyId), eq(studies.userId, userId)));
    return row || undefined;
  }

  async deleteStudyForUser(studyId: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(studies)
      .where(and(eq(studies.id, studyId), eq(studies.userId, userId)))
      .returning();
    return deleted.length > 0;
  }

  async replaceStudyMembers(
    studyId: string,
    entries: Array<{
      photoId: string;
      role: string;
      weeksAfter?: number | null;
      interventionLabel?: string | null;
      sortOrder: number;
    }>,
  ): Promise<void> {
    await db.delete(studyPhotos).where(eq(studyPhotos.studyId, studyId));
    if (entries.length === 0) return;
    await db.insert(studyPhotos).values(
      entries.map((e) => ({
        studyId,
        photoId: e.photoId,
        role: e.role,
        weeksAfter: e.weeksAfter ?? null,
        interventionLabel: e.interventionLabel ?? null,
        sortOrder: e.sortOrder,
      })),
    );
  }

  async getStudyPhotosWithPhotos(
    studyId: string,
  ): Promise<Array<{ studyPhoto: StudyPhoto; photo: Photo }>> {
    const rows = await db
      .select({ sp: studyPhotos, p: photos })
      .from(studyPhotos)
      .innerJoin(photos, eq(studyPhotos.photoId, photos.id))
      .where(eq(studyPhotos.studyId, studyId))
      .orderBy(asc(studyPhotos.sortOrder));
    return rows.map((r) => ({ studyPhoto: r.sp, photo: r.p }));
  }

  async createPairAnalysis(insert: InsertPairAnalysis): Promise<PairAnalysisRow> {
    const [row] = await db.insert(pairAnalysis).values(insert).returning();
    return row!;
  }

  async deletePairAnalysesForStudy(studyId: string): Promise<void> {
    await db.delete(pairAnalysis).where(eq(pairAnalysis.studyId, studyId));
  }

  async getPairAnalysesForStudy(studyId: string): Promise<PairAnalysisRow[]> {
    return db.select().from(pairAnalysis).where(eq(pairAnalysis.studyId, studyId));
  }

  async getStudyMemberByPhoto(studyId: string, photoId: string): Promise<StudyPhoto | undefined> {
    const [row] = await db
      .select()
      .from(studyPhotos)
      .where(and(eq(studyPhotos.studyId, studyId), eq(studyPhotos.photoId, photoId)));
    return row || undefined;
  }

  async getPairAnalysisForAfterPhoto(
    userId: string,
    afterPhotoId: string,
  ): Promise<PairAnalysisRow | undefined> {
    const rows = await db
      .select({ pa: pairAnalysis })
      .from(pairAnalysis)
      .innerJoin(studies, eq(pairAnalysis.studyId, studies.id))
      .where(and(eq(studies.userId, userId), eq(pairAnalysis.afterPhotoId, afterPhotoId)))
      .orderBy(desc(pairAnalysis.createdAt))
      .limit(1);
    return rows[0]?.pa;
  }

  async getPairAnalysisForPair(
    userId: string,
    photoAId: string,
    photoBId: string,
  ): Promise<PairAnalysisRow | undefined> {
    const rows = await db
      .select({ pa: pairAnalysis })
      .from(pairAnalysis)
      .innerJoin(studies, eq(pairAnalysis.studyId, studies.id))
      .where(
        and(
          eq(studies.userId, userId),
          or(
            and(
              eq(pairAnalysis.beforePhotoId, photoAId),
              eq(pairAnalysis.afterPhotoId, photoBId),
            ),
            and(
              eq(pairAnalysis.beforePhotoId, photoBId),
              eq(pairAnalysis.afterPhotoId, photoAId),
            ),
          ),
        ),
      )
      .orderBy(desc(pairAnalysis.createdAt))
      .limit(1);
    return rows[0]?.pa;
  }

  async findStudyForPhotoPair(
    userId: string,
    photoAId: string,
    photoBId: string,
  ): Promise<Study | undefined> {
    const userStudies = await db
      .select()
      .from(studies)
      .where(eq(studies.userId, userId))
      .orderBy(desc(studies.createdAt));
    for (const study of userStudies) {
      const members = await db
        .select()
        .from(studyPhotos)
        .where(eq(studyPhotos.studyId, study.id));
      const hasA = members.some((member) => member.photoId === photoAId);
      const hasB = members.some((member) => member.photoId === photoBId);
      if (hasA && hasB) {
        return study;
      }
    }
    return undefined;
  }
}

export const storage = new DatabaseStorage();
