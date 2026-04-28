import type { PairMetrics } from "@shared/cohort-metrics";

export interface InterventionRow {
  afterPhotoId: string;
  interventionLabel: string | null;
  weeksAfter: number | null;
  metrics: PairMetrics;
}

export interface AggregateMetric {
  metric: keyof PairMetrics;
  label: string;
  meanDelta: number;
  medianDelta: number;
  n: number;
  bootstrapCi95Low: number;
  bootstrapCi95High: number;
}

export interface InterventionRanking {
  interventionLabel: string;
  n: number;
  /** Mean of a composite score: negative age delta + negative wrinkle deltas + positive perceived deltas (scaled). */
  compositeScoreMean: number;
  /** Mean ranks across metric ranks (lower = better aging outcomes). */
  averageRank: number;
}

function metricKeysForRanking(): (keyof PairMetrics)[] {
  return [
    "deltaPredictedFacialAge",
    "deltaSubclinicalWrinkles",
    "deltaWrinkles",
    "perceivedSkinFirmnessDelta",
    "perceivedDensityDelta",
    "perceivedFacialFullnessDelta",
    "perceivedGonialAngleDelta",
  ];
}

/** Higher composite = better perceived rejuvenation direction (exploratory weighting). */
function compositeScore(m: PairMetrics): number {
  return (
    -m.deltaPredictedFacialAge -
    0.5 * m.deltaSubclinicalWrinkles -
    0.5 * m.deltaWrinkles +
    m.perceivedSkinFirmnessDelta +
    m.perceivedDensityDelta +
    m.perceivedFacialFullnessDelta +
    m.perceivedGonialAngleDelta
  );
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function bootstrapMeanCi(
  values: number[],
  iterations: number,
  seed: number,
): { low: number; high: number } {
  if (values.length === 0) return { low: 0, high: 0 };
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
    means.push(mean(sample));
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(iterations * 0.025)] ?? means[0]!;
  const hi = means[Math.floor(iterations * 0.975)] ?? means[means.length - 1]!;
  return { low: lo, high: hi };
}

export function aggregateByMetric(
  rows: InterventionRow[],
  bootstrapIterations = 800,
): AggregateMetric[] {
  const keys = metricKeysForRanking().filter((k) => k !== "notes" && k !== "confidence");
  const labels: Partial<Record<keyof PairMetrics, string>> = {
    deltaPredictedFacialAge: "Δ Predicted Facial Age (Years)",
    deltaSubclinicalWrinkles: "Δ Subclinical Wrinkle Appearance",
    deltaWrinkles: "Δ Wrinkle Appearance",
    perceivedSkinFirmnessDelta: "Δ Perceived Skin Firmness",
    perceivedDensityDelta: "Δ Perceived Skin Density",
    perceivedFacialFullnessDelta: "Δ Perceived Facial Fullness",
    perceivedGonialAngleDelta: "Δ Perceived Gonial Angle",
  };

  const out: AggregateMetric[] = [];
  for (const key of keys) {
    const values = rows
      .map((r) => r.metrics[key] as number | undefined)
      .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
    const m = mean(values);
    const med = median(values);
    const ci = bootstrapMeanCi(values, bootstrapIterations, key.length * 9973);
    out.push({
      metric: key,
      label: labels[key] ?? key,
      meanDelta: m,
      medianDelta: med,
      n: values.length,
      bootstrapCi95Low: ci.low,
      bootstrapCi95High: ci.high,
    });
  }
  return out;
}

export function rankInterventions(rows: InterventionRow[]): InterventionRanking[] {
  const byLabel = new Map<string, InterventionRow[]>();
  for (const row of rows) {
    const label = row.interventionLabel?.trim() || "Unspecified";
    const list = byLabel.get(label) ?? [];
    list.push(row);
    byLabel.set(label, list);
  }

  const rankings: InterventionRanking[] = [];

  for (const [interventionLabel, group] of byLabel) {
    const composites = group.map((r) => compositeScore(r.metrics));
    rankings.push({
      interventionLabel,
      n: group.length,
      compositeScoreMean: mean(composites),
      averageRank: 0,
    });
  }

  rankings.sort((a, b) => b.compositeScoreMean - a.compositeScoreMean);

  rankings.forEach((r, i) => {
    r.averageRank = i + 1;
  });

  return rankings;
}
