import { z } from "zod";
import {
  SUB_REGION_KEYS,
  PREPROCESSING_VERSION,
  RUBRIC_VERSION,
  type PairMetrics,
} from "./cohort-metrics";

/**
 * Composite improvement score.
 *
 * Two properties this module exists to guarantee:
 *
 *  1. The Wrinkles domain is built from the seven anatomic SUB-REGION deltas —
 *     the same construction the raw research pipeline uses. There is no
 *     fallback to the coarse `deltaWrinkles` field; a pair without sub-regions
 *     is unscoreable, not approximately scoreable.
 *
 *  2. Standardization is against a FROZEN reference (mean/sd captured from a
 *     fixed cohort run), not against whatever rows happen to be in the table.
 *     A new photo pair can therefore be scored alone, and scoring it does not
 *     move anybody else's historical score.
 *
 * Any domain that cannot be computed from complete inputs yields null, and a
 * null domain makes the composite null. Nothing is imputed.
 */

export const DOMAIN_KEYS = ["age", "wrinkles", "volume", "jawline"] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

const domainStatsSchema = z.object({
  mean: z.number(),
  /** Sample standard deviation (ddof=1). Must be > 0 to be usable. */
  sd: z.number().positive(),
  n: z.number().int().positive(),
});

export const cohortReferenceSchema = z.object({
  referenceVersion: z.string(),
  builtAt: z.string(),
  /** A score is only valid against a reference built the same way. */
  rubricVersion: z.string(),
  preprocessingVersion: z.string(),
  modelId: z.string(),
  sampleSize: z.number().int().positive(),
  domains: z.object({
    age: domainStatsSchema,
    wrinkles: domainStatsSchema,
    volume: domainStatsSchema,
    jawline: domainStatsSchema,
  }),
  /** Ascending composite scores of the reference cohort, for percentile lookup. */
  compositeDistribution: z.array(z.number()).min(2),
});

export type CohortReference = z.infer<typeof cohortReferenceSchema>;

export interface DomainBreakdown {
  /** Raw domain value in its native units, before standardization. */
  raw: number | null;
  /** Standardized against the frozen reference. Null whenever raw is null. */
  z: number | null;
  /** Populated when the domain could not be computed, for display + audit. */
  unavailableReason: string | null;
}

export interface ImprovementScore {
  domains: Record<DomainKey, DomainBreakdown>;
  /** Mean of the four domain z-scores. Null unless all four are present. */
  composite: number | null;
  /** Position within the frozen reference distribution, 0..100. */
  percentile: number | null;
  unavailableReason: string | null;
  reference: {
    referenceVersion: string;
    sampleSize: number;
  } | null;
}

function allPresent(values: Array<number | null | undefined>): number[] | null {
  const out: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Younger after = improvement, so the years delta is sign-flipped. */
function domainAge(m: PairMetrics): number | null {
  const v = m.deltaPredictedFacialAge;
  return v === null || !Number.isFinite(v) ? null : -v;
}

/**
 * Mean of all seven sub-region severity deltas, sign-flipped so positive =
 * improvement. Requires every region: the reference statistics were built on
 * the full seven, so a partial mean is a different estimator and would not be
 * comparable.
 */
function domainWrinkles(m: PairMetrics): number | null {
  const deltas = allPresent(SUB_REGION_KEYS.map((k) => m.subRegions?.[k]?.delta));
  if (!deltas) return null;
  return mean(deltas.map((d) => -d));
}

/** Perception fields (−50..+50) where positive already means better. */
function domainVolume(m: PairMetrics): number | null {
  const vals = allPresent([
    m.perceivedSkinFirmnessDelta,
    m.perceivedDensityDelta,
    m.perceivedFacialFullnessDelta,
  ]);
  return vals ? mean(vals) : null;
}

/** Combines −jawlineLaxityDelta (severity, so flipped) with the gonial angle delta. */
function domainJawline(m: PairMetrics): number | null {
  const vals = allPresent([m.subRegions?.jawlineLaxity?.delta, m.perceivedGonialAngleDelta]);
  if (!vals) return null;
  const [laxity, gonial] = vals as [number, number];
  return mean([-laxity, gonial]);
}

export function computeRawDomains(m: PairMetrics): Record<DomainKey, number | null> {
  return {
    age: domainAge(m),
    wrinkles: domainWrinkles(m),
    volume: domainVolume(m),
    jawline: domainJawline(m),
  };
}

const DOMAIN_INPUT_DESCRIPTION: Record<DomainKey, string> = {
  age: "deltaPredictedFacialAge missing",
  wrinkles: "one or more of the 7 sub-region deltas missing",
  volume: "one or more perceived firmness/density/fullness deltas missing",
  jawline: "jawlineLaxity sub-region delta or perceivedGonialAngleDelta missing",
};

/** Fraction of the reference distribution below `value`, as 0..100. */
export function percentileAgainst(sortedAscending: number[], value: number): number {
  const n = sortedAscending.length;
  let below = 0;
  let equal = 0;
  for (const v of sortedAscending) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  // Midpoint of the tie block, so identical scores get identical percentiles.
  return ((below + equal / 2) / n) * 100;
}

export interface ScoreContext {
  rubricVersion: string;
  preprocessingVersion: string;
}

/**
 * Score one pair against a frozen reference.
 *
 * Returns an all-null score (with a reason) rather than throwing, so callers
 * can render N/A per domain instead of failing the whole study.
 */
export function computeImprovementScore(
  metrics: PairMetrics,
  reference: CohortReference | null,
  context: ScoreContext = {
    rubricVersion: RUBRIC_VERSION,
    preprocessingVersion: PREPROCESSING_VERSION,
  },
): ImprovementScore {
  const raw = computeRawDomains(metrics);

  const emptyDomains = (): Record<DomainKey, DomainBreakdown> => {
    const d = {} as Record<DomainKey, DomainBreakdown>;
    for (const k of DOMAIN_KEYS) {
      d[k] = {
        raw: raw[k],
        z: null,
        unavailableReason: raw[k] === null ? DOMAIN_INPUT_DESCRIPTION[k] : null,
      };
    }
    return d;
  };

  if (!reference) {
    return {
      domains: emptyDomains(),
      composite: null,
      percentile: null,
      unavailableReason:
        "No frozen cohort reference is installed, so scores cannot be standardized.",
      reference: null,
    };
  }

  // A z-score is only meaningful against a reference produced the same way.
  if (reference.rubricVersion !== context.rubricVersion) {
    return {
      domains: emptyDomains(),
      composite: null,
      percentile: null,
      unavailableReason:
        `Reference was built with rubric ${reference.rubricVersion} but this pair was ` +
        `scored with rubric ${context.rubricVersion}.`,
      reference: { referenceVersion: reference.referenceVersion, sampleSize: reference.sampleSize },
    };
  }

  if (reference.preprocessingVersion !== context.preprocessingVersion) {
    return {
      domains: emptyDomains(),
      composite: null,
      percentile: null,
      unavailableReason:
        `Reference was built on images preprocessed as ${reference.preprocessingVersion} but ` +
        `this pair used ${context.preprocessingVersion}. Scores are not comparable.`,
      reference: { referenceVersion: reference.referenceVersion, sampleSize: reference.sampleSize },
    };
  }

  const domains = {} as Record<DomainKey, DomainBreakdown>;
  for (const key of DOMAIN_KEYS) {
    const rawValue = raw[key];
    if (rawValue === null) {
      domains[key] = { raw: null, z: null, unavailableReason: DOMAIN_INPUT_DESCRIPTION[key] };
      continue;
    }
    const stats = reference.domains[key];
    domains[key] = {
      raw: rawValue,
      z: (rawValue - stats.mean) / stats.sd,
      unavailableReason: null,
    };
  }

  const zs = allPresent(DOMAIN_KEYS.map((k) => domains[k].z));
  if (!zs) {
    const missing = DOMAIN_KEYS.filter((k) => domains[k].z === null);
    return {
      domains,
      composite: null,
      percentile: null,
      unavailableReason: `Composite needs all four domains; missing: ${missing.join(", ")}.`,
      reference: { referenceVersion: reference.referenceVersion, sampleSize: reference.sampleSize },
    };
  }

  const composite = mean(zs);
  return {
    domains,
    composite,
    percentile: percentileAgainst(reference.compositeDistribution, composite),
    unavailableReason: null,
    reference: { referenceVersion: reference.referenceVersion, sampleSize: reference.sampleSize },
  };
}
