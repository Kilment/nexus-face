import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  replitId: text("replit_id").unique(),
  username: text("username").notNull(),
  profileImageUrl: text("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const photos = pgTable("photos", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  originalImageUrl: text("original_image_url"),
  processedImageUrl: text("processed_image_url").notNull(),
  processedImageBase64: text("processed_image_base64"),
  initials: varchar("initials", { length: 3 }).notNull(),
  beforeAfter: varchar("before_after", { length: 10 }).notNull(),
  locationCode: varchar("location_code", { length: 50 }).notNull(),
  linkedPhotoId: varchar("linked_photo_id"),
  improvementScore: integer("improvement_score"),
  gender: varchar("gender", { length: 20 }),
  ageRange: varchar("age_range", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  photos: many(photos),
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

export const insertUserSchema = createInsertSchema(users).pick({
  replitId: true,
  username: true,
  profileImageUrl: true,
});

export const insertPhotoSchema = createInsertSchema(photos).pick({
  userId: true,
  originalImageUrl: true,
  processedImageUrl: true,
  processedImageBase64: true,
  initials: true,
  beforeAfter: true,
  locationCode: true,
  linkedPhotoId: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photos.$inferSelect;
