import { z } from "zod";

/**
 * Rubric v1.1 — the ONLY rubric. Field names, scales and sign conventions here
 * mirror shared/rubric.v1.1.json, which carries the prompt text that both the
 * in-app scorer (server/vision-rubric.ts) and the batch research scorer
 * (scripts/score_pairs.py) send to the model. server/vision-rubric.ts asserts
 * at load time that this schema and that JSON have not drifted apart.
 *
 * `null` on any scored field means "not determinable" and must surface as N/A.
 * It never means zero, and it must never be coerced into one.
 */

export const SUB_REGION_KEYS = [
  "crowsFeet",
  "nasolabialFolds",
  "foreheadLines",
  "glabellarLines",
  "perioralLines",
  "underEyeHollows",
  "jawlineLaxity",
] as const;

export type SubRegionKey = (typeof SUB_REGION_KEYS)[number];

/** Severity 0..100 per image plus the AFTER-minus-BEFORE delta. */
const subRegionScoreSchema = z.object({
  before: z.number().min(0).max(100).nullable(),
  after: z.number().min(0).max(100).nullable(),
  delta: z.number().min(-100).max(100).nullable(),
});

export type SubRegionScore = z.infer<typeof subRegionScoreSchema>;

const subRegionsSchema = z.object({
  crowsFeet: subRegionScoreSchema,
  nasolabialFolds: subRegionScoreSchema,
  foreheadLines: subRegionScoreSchema,
  glabellarLines: subRegionScoreSchema,
  perioralLines: subRegionScoreSchema,
  underEyeHollows: subRegionScoreSchema,
  jawlineLaxity: subRegionScoreSchema,
});

/** Model-estimated pairwise outcome (research exploratory; not clinical device output). */
export const pairMetricsSchema = z.object({
  predictedFacialAgeBefore: z.number().min(0).max(120).nullable(),
  predictedFacialAgeAfter: z.number().min(0).max(120).nullable(),
  deltaPredictedFacialAge: z.number().min(-40).max(40).nullable(),

  wrinklesBefore: z.number().min(0).max(100).nullable(),
  wrinklesAfter: z.number().min(0).max(100).nullable(),
  deltaWrinkles: z.number().min(-100).max(100).nullable(),

  /** Visible / apparent subclinical wrinkle appearance change (− = improvement if lower is better). */
  subclinicalWrinklesBefore: z.number().min(0).max(100).nullable(),
  subclinicalWrinklesAfter: z.number().min(0).max(100).nullable(),
  deltaSubclinicalWrinkles: z.number().min(-100).max(100).nullable(),

  perceivedSkinFirmnessDelta: z.number().min(-50).max(50).nullable(),
  perceivedDensityDelta: z.number().min(-50).max(50).nullable(),
  perceivedFacialFullnessDelta: z.number().min(-50).max(50).nullable(),
  perceivedGonialAngleDelta: z.number().min(-10).max(10).nullable(),

  /** Per-anatomic-region breakdown. Drives the Wrinkles domain of the improvement score. */
  subRegions: subRegionsSchema,

  confidence: z.number().min(0).max(1).nullable().optional(),
  notes: z.string().optional(),
});

export type PairMetrics = z.infer<typeof pairMetricsSchema>;

/**
 * 2D landmark proxies. Null when no face was detected or the geometry could not
 * be derived — previously these were emitted as 0, which then subtracted into
 * real-looking non-zero deltas.
 */
export const landmarkMetricsSchema = z.object({
  leftGonialProxyDeg: z.number().nullable(),
  rightGonialProxyDeg: z.number().nullable(),
  cheekFullnessRatio: z.number().nullable(),
  jawWidthToFaceHeightRatio: z.number().nullable(),
  faceDetected: z.boolean(),
});

export type LandmarkMetrics = z.infer<typeof landmarkMetricsSchema>;

/**
 * Provenance for a single scored pair. Without this a score cannot be
 * reproduced or compared against the frozen cohort reference.
 */
export const scoreProvenanceSchema = z.object({
  rubricVersion: z.string(),
  analysisVersion: z.string(),
  /** Resolved, dated model snapshot — never a floating alias like "gpt-4o". */
  modelId: z.string(),
  /** Identifies the exact image preprocessing both images went through. */
  preprocessingVersion: z.string(),
  /** True when de-identification fell back to the generative path for either image. */
  generativeDeIdUsed: z.boolean(),
  scoredAt: z.string(),
});

export type ScoreProvenance = z.infer<typeof scoreProvenanceSchema>;

/** Bump when the rubric, preprocessing, or domain definitions change. */
export const ANALYSIS_VERSION = "2.0.0";
export const RUBRIC_VERSION = "1.1.0";

/**
 * Canonical preprocessing contract. A pair may only be compared against a
 * frozen reference built under the same string.
 */
export const PREPROCESSING_VERSION = "deid+standardize512+harmonize@1.0.0";

/** Render helper — the single place that decides what an absent value looks like. */
export const NOT_AVAILABLE = "N/A";

export function formatMetric(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE;
  return value.toFixed(digits);
}
