-- Drop the fabricated ethnicity column.
--
-- server/rekognition.ts hardcoded `ethnicity: "White"` for every face. AWS
-- Rekognition DetectFaces does not return race or ethnicity, so every stored
-- value was invented rather than detected. There is no way to backfill a
-- truthful value from the images, so the column is removed rather than nulled:
-- keeping it would invite it being repopulated the same way.
--
-- If ethnicity is needed for cohort work it must be collected as recorded
-- participant metadata, in its own explicitly-sourced column.
--
-- Inspect the blast radius before applying:
--   SELECT ethnicity, COUNT(*) FROM photos GROUP BY ethnicity;

ALTER TABLE "photos" DROP COLUMN IF EXISTS "ethnicity";

-- Provenance and improvement score for each analysed pair. Both are nullable:
-- rows scored before this migration have no recorded provenance, and a score
-- that cannot be computed must read as absent rather than as zero.
ALTER TABLE "pair_analysis" ADD COLUMN IF NOT EXISTS "provenance" jsonb;
ALTER TABLE "pair_analysis" ADD COLUMN IF NOT EXISTS "improvement_score" jsonb;
