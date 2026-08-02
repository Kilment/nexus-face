import {
  SUB_REGION_KEYS,
  PREPROCESSING_VERSION,
  RUBRIC_VERSION,
  type PairMetrics,
} from "@shared/cohort-metrics";
import {
  computeImprovementScore,
  type CohortReference,
} from "@shared/improvement-score";

export interface InterventionRow {
  afterPhotoId: string;
  interventionLabel: string | null;
  weeksAfter: number | null;
  metrics: PairMetrics;
}

export interface AggregateMetric {
  metric: string;
  label: string;
  /** Null when no pair contributed a value — never 0, which reads as "no change". */
  meanDelta: number | null;
  medianDelta: number | null;
  /** Pairs that actually contributed a value to this metric. */
  n: number;
  /** Pairs where this metric was N/A. */
  nMissing: number;
  bootstrapCi95Low: number | null;
  bootstrapCi95High: number | null;
}

export interface InterventionRanking {
  interventionLabel: string;
  n: number;
  /**
   * Mean composite improvement score across the group's scoreable pairs, using
   * the same frozen-reference, sub-region-based score as everywhere else.
   * Null when no pair in the group could be scored.
   */
  compositeScoreMean: number | null;
  /** Pairs in the group that could not be scored at all. */
  nUnscoreable: number;
  /** Null when the group has no composite to rank on. */
  averageRank: number | null;
}

/** Top-level delta metrics plus the seven sub-region deltas. */
function metricKeysForAggregation(): string[] {
  return [
    "deltaPredictedFacialAge",
    "deltaSubclinicalWrinkles",
    "deltaWrinkles",
    "perceivedSkinFirmnessDelta",
    "perceivedDensityDelta",
    "perceivedFacialFullnessDelta",
    "perceivedGonialAngleDelta",
    ...SUB_REGION_KEYS.map((k) => `subRegions.${k}.delta`),
  ];
}

const LABELS: Record<string, string> = {
  deltaPredictedFacialAge: "Δ Predicted Facial Age (Years)",
  deltaSubclinicalWrinkles: "Δ Subclinical Wrinkle Appearance",
  deltaWrinkles: "Δ Wrinkle Appearance",
  perceivedSkinFirmnessDelta: "Δ Perceived Skin Firmness",
  perceivedDensityDelta: "Δ Perceived Skin Density",
  perceivedFacialFullnessDelta: "Δ Perceived Facial Fullness",
  perceivedGonialAngleDelta: "Δ Perceived Gonial Angle",
  "subRegions.crowsFeet.delta": "Δ Crow's Feet Severity",
  "subRegions.nasolabialFolds.delta": "Δ Nasolabial Fold Severity",
  "subRegions.foreheadLines.delta": "Δ Forehead Line Severity",
  "subRegions.glabellarLines.delta": "Δ Glabellar Line Severity",
  "subRegions.perioralLines.delta": "Δ Perioral Line Severity",
  "subRegions.underEyeHollows.delta": "Δ Under-Eye Hollow Severity",
  "subRegions.jawlineLaxity.delta": "Δ Jawline Laxity Severity",
};

/** Reads either a top-level metric or a `subRegions.<key>.delta` path. */
function readMetric(metrics: PairMetrics, key: string): number | null {
  if (key.startsWith("subRegions.")) {
    const region = key.split(".")[1] as (typeof SUB_REGION_KEYS)[number];
    const value = metrics.subRegions?.[region]?.delta;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  const value = metrics[key as keyof PairMetrics];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function bootstrapMeanCi(
  values: number[],
  iterations: number,
  seed: number,
): { low: number | null; high: number | null } {
  // A CI needs variability to estimate. One observation has none, and
  // returning [0, 0] or [x, x] would overstate precision.
  if (values.length < 2) return { low: null, high: null };

  let rng = seed;
  const next = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };

  const means: number[] = [];
  const n = values.length;
  for (let i = 0; i < iterations; i++) {
    const sample: number[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(values[Math.floor(next() * n)]!);
    }
    means.push(mean(sample)!);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(iterations * 0.025)] ?? means[0]!;
  const hi = means[Math.floor(iterations * 0.975)] ?? means[means.length - 1]!;
  return { low: lo, high: hi };
}

/** Deterministic per-metric seed so repeated runs give identical CIs. */
function seedFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647 || 1;
}

export function aggregateByMetric(
  rows: InterventionRow[],
  bootstrapIterations = 800,
): AggregateMetric[] {
  const out: AggregateMetric[] = [];

  for (const key of metricKeysForAggregation()) {
    const values: number[] = [];
    let missing = 0;
    for (const row of rows) {
      const v = readMetric(row.metrics, key);
      if (v === null) missing += 1;
      else values.push(v);
    }

    const ci = bootstrapMeanCi(values, bootstrapIterations, seedFor(key));
    out.push({
      metric: key,
      label: LABELS[key] ?? key,
      meanDelta: mean(values),
      medianDelta: median(values),
      n: values.length,
      nMissing: missing,
      bootstrapCi95Low: ci.low,
      bootstrapCi95High: ci.high,
    });
  }

  return out;
}

export function rankInterventions(
  rows: InterventionRow[],
  reference: CohortReference | null,
  modelId: string,
): InterventionRanking[] {
  const byLabel = new Map<string, InterventionRow[]>();
  for (const row of rows) {
    const label = row.interventionLabel?.trim() || "Unspecified";
    const list = byLabel.get(label) ?? [];
    list.push(row);
    byLabel.set(label, list);
  }

  const rankings: InterventionRanking[] = [];

  for (const [interventionLabel, group] of byLabel) {
    const composites: number[] = [];
    let unscoreable = 0;
    for (const row of group) {
      const score = computeImprovementScore(row.metrics, reference, {
        rubricVersion: RUBRIC_VERSION,
        preprocessingVersion: PREPROCESSING_VERSION,
        modelId,
      });
      if (score.composite === null) unscoreable += 1;
      else composites.push(score.composite);
    }

    rankings.push({
      interventionLabel,
      n: group.length,
      compositeScoreMean: mean(composites),
      nUnscoreable: unscoreable,
      averageRank: null,
    });
  }

  // Rankable groups sort by composite; groups with nothing to rank keep a null
  // rank rather than being placed last as if they had scored worst.
  const rankable = rankings.filter((r) => r.compositeScoreMean !== null);
  const unrankable = rankings.filter((r) => r.compositeScoreMean === null);
  rankable.sort((a, b) => b.compositeScoreMean! - a.compositeScoreMean!);
  rankable.forEach((r, i) => {
    r.averageRank = i + 1;
  });

  return [...rankable, ...unrankable];
}
