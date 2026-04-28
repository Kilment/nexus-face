import { z } from "zod";

/** Model-estimated pairwise outcome (research exploratory; not clinical device output). */
export const pairMetricsSchema = z.object({
  predictedFacialAgeBefore: z.number(),
  predictedFacialAgeAfter: z.number(),
  deltaPredictedFacialAge: z.number(),
  /** Visible / apparent subclinical wrinkle appearance change (− = improvement if lower is better). */
  deltaSubclinicalWrinkles: z.number(),
  deltaWrinkles: z.number(),
  perceivedSkinFirmnessDelta: z.number(),
  perceivedDensityDelta: z.number(),
  perceivedFacialFullnessDelta: z.number(),
  perceivedGonialAngleDelta: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
});

export type PairMetrics = z.infer<typeof pairMetricsSchema>;

export const landmarkMetricsSchema = z.object({
  leftGonialProxyDeg: z.number(),
  rightGonialProxyDeg: z.number(),
  cheekFullnessRatio: z.number(),
  jawWidthToFaceHeightRatio: z.number(),
  faceDetected: z.boolean(),
});

export type LandmarkMetrics = z.infer<typeof landmarkMetricsSchema>;

export const ANALYSIS_VERSION = "1.0.0";
