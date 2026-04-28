-- Incremental: add cohort study tables (safe if users/photos already exist)
CREATE TABLE IF NOT EXISTS "studies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studies" DROP CONSTRAINT IF EXISTS "studies_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_photos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" varchar NOT NULL,
	"photo_id" varchar NOT NULL,
	"role" varchar(10) NOT NULL,
	"weeks_after" integer,
	"intervention_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_photos" DROP CONSTRAINT IF EXISTS "study_photos_study_id_studies_id_fk";
--> statement-breakpoint
ALTER TABLE "study_photos" DROP CONSTRAINT IF EXISTS "study_photos_photo_id_photos_id_fk";
--> statement-breakpoint
ALTER TABLE "study_photos" ADD CONSTRAINT "study_photos_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "study_photos" ADD CONSTRAINT "study_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "study_photos_study_photo_idx" ON "study_photos" USING btree ("study_id","photo_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pair_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" varchar NOT NULL,
	"before_photo_id" varchar NOT NULL,
	"after_photo_id" varchar NOT NULL,
	"analysis_version" varchar(64) NOT NULL,
	"model_id" varchar(128) NOT NULL,
	"metrics" jsonb NOT NULL,
	"landmark_metrics" jsonb,
	"raw_artifact" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pair_analysis" DROP CONSTRAINT IF EXISTS "pair_analysis_study_id_studies_id_fk";
--> statement-breakpoint
ALTER TABLE "pair_analysis" DROP CONSTRAINT IF EXISTS "pair_analysis_before_photo_id_photos_id_fk";
--> statement-breakpoint
ALTER TABLE "pair_analysis" DROP CONSTRAINT IF EXISTS "pair_analysis_after_photo_id_photos_id_fk";
--> statement-breakpoint
ALTER TABLE "pair_analysis" ADD CONSTRAINT "pair_analysis_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pair_analysis" ADD CONSTRAINT "pair_analysis_before_photo_id_photos_id_fk" FOREIGN KEY ("before_photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pair_analysis" ADD CONSTRAINT "pair_analysis_after_photo_id_photos_id_fk" FOREIGN KEY ("after_photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pair_analysis_study_after_idx" ON "pair_analysis" USING btree ("study_id","after_photo_id");
