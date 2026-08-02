import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Apple's stable subject identifier ("sub" claim). The production identity. */
  appleSub: text("apple_sub").unique(),
  replitId: text("replit_id").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  username: text("username").notNull(),
  profileImageUrl: text("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Server-side sessions.
 *
 * Authentication previously trusted a client-supplied `X-User-Id` header, so
 * anyone who knew or guessed a user id was that user. Tokens are now random,
 * server-issued, and stored only as a SHA-256 hash: a database disclosure does
 * not yield usable credentials.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the bearer token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("sessions_token_hash_idx").on(t.tokenHash)],
);

export const photos = pgTable("photos", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  originalImageUrl: text("original_image_url"),
  processedImageUrl: text("processed_image_url").notNull(),
  processedImageBase64: text("processed_image_base64"),
  standardizedImageBase64: text("standardized_image_base64"),
  initials: varchar("initials", { length: 3 }).notNull(),
  beforeAfter: varchar("before_after", { length: 10 }).notNull(),
  locationCode: varchar("location_code", { length: 50 }).notNull(),
  linkedPhotoId: varchar("linked_photo_id"),
  // Null on either field means "not determined" and renders as N/A.
  // There is deliberately no ethnicity column: DetectFaces does not return
  // race, so any stored value would be fabricated rather than detected.
  gender: varchar("gender", { length: 20 }),
  ageRange: varchar("age_range", { length: 20 }),
  weeksAfter: integer("weeks_after"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Cohort / study batch for research analysis (one before, many after). */
export const studies = pgTable("studies", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const studyPhotos = pgTable(
  "study_photos",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    studyId: varchar("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    photoId: varchar("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 }).notNull(),
    weeksAfter: integer("weeks_after"),
    interventionLabel: text("intervention_label"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("study_photos_study_photo_idx").on(t.studyId, t.photoId)],
);

export const pairAnalysis = pgTable(
  "pair_analysis",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    studyId: varchar("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    beforePhotoId: varchar("before_photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    afterPhotoId: varchar("after_photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    analysisVersion: varchar("analysis_version", { length: 64 }).notNull(),
    modelId: varchar("model_id", { length: 128 }).notNull(),
    metrics: jsonb("metrics").notNull(),
    landmarkMetrics: jsonb("landmark_metrics"),
    /** Rubric/preprocessing/model provenance — a score is only comparable within matching provenance. */
    provenance: jsonb("provenance"),
    /** Domain z-scores, composite and percentile against the frozen reference. Null fields mean N/A. */
    improvementScore: jsonb("improvement_score"),
    rawArtifact: text("raw_artifact"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("pair_analysis_study_after_idx").on(t.studyId, t.afterPhotoId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  photos: many(photos),
  studies: many(studies),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  user: one(users, {
    fields: [photos.userId],
    references: [users.id],
  }),
  linkedPhoto: one(photos, {
    fields: [photos.linkedPhotoId],
    references: [photos.id],
  }),
}));

export const studiesRelations = relations(studies, ({ many, one }) => ({
  user: one(users, {
    fields: [studies.userId],
    references: [users.id],
  }),
  studyPhotos: many(studyPhotos),
  pairAnalyses: many(pairAnalysis),
}));

export const studyPhotosRelations = relations(studyPhotos, ({ one }) => ({
  study: one(studies, {
    fields: [studyPhotos.studyId],
    references: [studies.id],
  }),
  photo: one(photos, {
    fields: [studyPhotos.photoId],
    references: [photos.id],
  }),
}));

export const pairAnalysisRelations = relations(pairAnalysis, ({ one }) => ({
  study: one(studies, {
    fields: [pairAnalysis.studyId],
    references: [studies.id],
  }),
  beforePhoto: one(photos, {
    fields: [pairAnalysis.beforePhotoId],
    references: [photos.id],
  }),
  afterPhoto: one(photos, {
    fields: [pairAnalysis.afterPhotoId],
    references: [photos.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  appleSub: true,
  replitId: true,
  email: true,
  passwordHash: true,
  username: true,
  profileImageUrl: true,
});

export const insertPhotoSchema = createInsertSchema(photos).pick({
  userId: true,
  originalImageUrl: true,
  processedImageUrl: true,
  processedImageBase64: true,
  standardizedImageBase64: true,
  initials: true,
  beforeAfter: true,
  locationCode: true,
  linkedPhotoId: true,
  gender: true,
  ageRange: true,
  weeksAfter: true,
});

export const insertStudySchema = createInsertSchema(studies).pick({
  userId: true,
  title: true,
});

export const insertStudyPhotoSchema = createInsertSchema(studyPhotos).pick({
  studyId: true,
  photoId: true,
  role: true,
  weeksAfter: true,
  interventionLabel: true,
  sortOrder: true,
});

export const insertPairAnalysisSchema = createInsertSchema(pairAnalysis).pick({
  studyId: true,
  beforePhotoId: true,
  afterPhotoId: true,
  analysisVersion: true,
  modelId: true,
  metrics: true,
  landmarkMetrics: true,
  provenance: true,
  improvementScore: true,
  rawArtifact: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photos.$inferSelect;
export type Study = typeof studies.$inferSelect;
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type StudyPhoto = typeof studyPhotos.$inferSelect;
export type InsertStudyPhoto = z.infer<typeof insertStudyPhotoSchema>;
export type PairAnalysisRow = typeof pairAnalysis.$inferSelect;
export type InsertPairAnalysis = z.infer<typeof insertPairAnalysisSchema>;
