import Anthropic from "@anthropic-ai/sdk";
import { createCanvas, loadImage } from "canvas";
import {
  pairMetricsSchema,
  SUB_REGION_KEYS,
  RUBRIC_VERSION,
  type PairMetrics,
} from "@shared/cohort-metrics";
import rubricSpec from "@shared/rubric.v1.1.json";

/** Lazy: importing this module must not require an API key. */
let client: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Pinned, dated snapshot — and it MUST match the model that built the frozen
 * cohort reference, or every composite comes back N/A by design.
 *
 * A floating alias ("claude-opus-5") silently re-points to a new model, which
 * shifts every score and invalidates the reference. Override only with another
 * dated snapshot, and rebuild the reference when you do.
 */
const DEFAULT_VISION_MODEL = "claude-opus-4-5-20251101";
const VISION_MODEL = process.env.COHORT_VISION_MODEL ?? DEFAULT_VISION_MODEL;

// Anything not ending in a YYYYMMDD date is an alias.
if (!/-\d{8}$/.test(VISION_MODEL)) {
  console.warn(
    `[vision-rubric] COHORT_VISION_MODEL="${VISION_MODEL}" is not a dated snapshot. ` +
      "Scores will drift when the alias re-points. Pin a dated snapshot " +
      `(e.g. "${DEFAULT_VISION_MODEL}") and rebuild the cohort reference.`,
  );
}

// Fail loudly at load if the schema and the shared rubric spec have drifted.
(function assertRubricMatchesSchema() {
  if (rubricSpec.rubricVersion !== RUBRIC_VERSION) {
    throw new Error(
      `Rubric version mismatch: shared/rubric.v1.1.json is ${rubricSpec.rubricVersion} but ` +
        `cohort-metrics.ts expects ${RUBRIC_VERSION}.`,
    );
  }
  const specRegions = rubricSpec.subRegions.map((r) => r.key);
  const missing = SUB_REGION_KEYS.filter((k) => !specRegions.includes(k));
  const extra = specRegions.filter((k) => !(SUB_REGION_KEYS as readonly string[]).includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `Rubric sub-region drift. Missing from spec: [${missing.join(", ")}]; ` +
        `unknown in spec: [${extra.join(", ")}].`,
    );
  }
})();

export function getVisionModelId(): string {
  return VISION_MODEL;
}

export function getRubricVersion(): string {
  return rubricSpec.rubricVersion;
}

interface LuminanceStats {
  mean: number;
  stdDev: number;
}

function computeLuminanceStats(data: Uint8ClampedArray): LuminanceStats {
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
    count += 1;
  }

  if (count === 0) {
    return { mean: 128, stdDev: 1 };
  }

  const mean = sum / count;
  const variance = Math.max(1, sumSq / count - mean * mean);
  return { mean, stdDev: Math.sqrt(variance) };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function normalizeImageToTargetLuminance(
  imageData: ImageData,
  source: LuminanceStats,
  target: LuminanceStats,
): void {
  const data = imageData.data;
  const stdRatio = Math.max(0.6, Math.min(1.8, target.stdDev / Math.max(1, source.stdDev)));
  const meanDelta = target.mean - source.mean;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const adjusted = ((data[i + c] - source.mean) * stdRatio) + source.mean + meanDelta;
      data[i + c] = clampByte(adjusted);
    }
  }
}

export async function harmonizePairLighting(
  beforeBase64: string,
  afterBase64: string,
): Promise<{ beforeBase64: string; afterBase64: string }> {
  const [beforeImg, afterImg] = await Promise.all([
    loadImage(Buffer.from(beforeBase64, "base64")),
    loadImage(Buffer.from(afterBase64, "base64")),
  ]);

  const beforeCanvas = createCanvas(beforeImg.width, beforeImg.height);
  const beforeCtx = beforeCanvas.getContext("2d");
  beforeCtx.drawImage(beforeImg, 0, 0, beforeImg.width, beforeImg.height);
  const beforeImageData = beforeCtx.getImageData(0, 0, beforeImg.width, beforeImg.height);

  const afterCanvas = createCanvas(afterImg.width, afterImg.height);
  const afterCtx = afterCanvas.getContext("2d");
  afterCtx.drawImage(afterImg, 0, 0, afterImg.width, afterImg.height);
  const afterImageData = afterCtx.getImageData(0, 0, afterImg.width, afterImg.height);

  const beforeStats = computeLuminanceStats(beforeImageData.data);
  const afterStats = computeLuminanceStats(afterImageData.data);
  const targetStats: LuminanceStats = {
    mean: (beforeStats.mean + afterStats.mean) / 2,
    stdDev: (beforeStats.stdDev + afterStats.stdDev) / 2,
  };

  normalizeImageToTargetLuminance(beforeImageData as unknown as ImageData, beforeStats, targetStats);
  normalizeImageToTargetLuminance(afterImageData as unknown as ImageData, afterStats, targetStats);

  beforeCtx.putImageData(beforeImageData, 0, 0);
  afterCtx.putImageData(afterImageData, 0, 0);

  return {
    beforeBase64: beforeCanvas.toBuffer("image/png").toString("base64"),
    afterBase64: afterCanvas.toBuffer("image/png").toString("base64"),
  };
}

/** Accept numeric strings and explicit nulls; anything else becomes null. */
function coerceScore(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || /^(n\/?a|null|unknown|undetermined)$/i.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceConfidence(value: unknown): number | null {
  const n = coerceScore(value);
  if (n === null) return null;
  // Models report either 0..1 or 0..100; normalize to 0..1.
  const scaled = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, scaled));
}

/** Flatten the model's response into the shape pairMetricsSchema validates. */
function normalizeResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const scalarKeys = [
    "predictedFacialAgeBefore",
    "predictedFacialAgeAfter",
    "deltaPredictedFacialAge",
    "wrinklesBefore",
    "wrinklesAfter",
    "deltaWrinkles",
    "subclinicalWrinklesBefore",
    "subclinicalWrinklesAfter",
    "deltaSubclinicalWrinkles",
    "perceivedSkinFirmnessDelta",
    "perceivedDensityDelta",
    "perceivedFacialFullnessDelta",
    "perceivedGonialAngleDelta",
  ];

  const out: Record<string, unknown> = {};
  for (const key of scalarKeys) out[key] = coerceScore(raw[key]);
  out.confidence = coerceConfidence(raw.confidence);
  out.notes = typeof raw.notes === "string" ? raw.notes : "";

  const rawRegions = (raw.subRegions ?? {}) as Record<string, unknown>;
  const subRegions: Record<string, { before: number | null; after: number | null; delta: number | null }> = {};
  for (const key of SUB_REGION_KEYS) {
    const block = (rawRegions[key] ?? {}) as Record<string, unknown>;
    subRegions[key] = {
      before: coerceScore(block.before),
      after: coerceScore(block.after),
      delta: coerceScore(block.delta),
    };
  }
  out.subRegions = subRegions;

  return out;
}

/**
 * The model reports each delta independently of the before/after pair it also
 * reports. When those disagree the response is internally inconsistent, and
 * quietly trusting either one would be inventing a result. Surface it instead.
 */
export function findSelfConsistencyViolations(metrics: PairMetrics): string[] {
  const problems: string[] = [];

  for (const check of rubricSpec.selfConsistency.checks) {
    const delta = metrics[check.delta as keyof PairMetrics] as number | null;
    const after = metrics[check.after as keyof PairMetrics] as number | null;
    const before = metrics[check.before as keyof PairMetrics] as number | null;
    if (delta === null || after === null || before === null) continue;
    const implied = after - before;
    if (Math.abs(implied - delta) > check.tolerance) {
      problems.push(
        `${check.delta}=${delta} disagrees with ${check.after}-${check.before}=${implied.toFixed(2)}`,
      );
    }
  }

  const tol = rubricSpec.selfConsistency.subRegionTolerance;
  for (const key of SUB_REGION_KEYS) {
    const region = metrics.subRegions[key];
    if (region.before === null || region.after === null || region.delta === null) continue;
    const implied = region.after - region.before;
    if (Math.abs(implied - region.delta) > tol) {
      problems.push(
        `subRegions.${key}.delta=${region.delta} disagrees with after-before=${implied.toFixed(2)}`,
      );
    }
  }

  return problems;
}

export interface PairScoreResult {
  metrics: PairMetrics;
  rawText: string;
  modelId: string;
  rubricVersion: string;
  /** Non-fatal integrity notes recorded alongside the score. */
  warnings: string[];
}

export async function scorePairWithVisionRubric(
  beforeBase64: string,
  afterBase64: string,
  options: { harmonizeLighting?: boolean; maxAttempts?: number } = {},
): Promise<PairScoreResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Vision rubric requires ANTHROPIC_API_KEY");
  }

  const { harmonizeLighting = true, maxAttempts = 3 } = options;
  const warnings: string[] = [];

  let comparisonBeforeBase64 = beforeBase64;
  let comparisonAfterBase64 = afterBase64;
  if (harmonizeLighting) {
    // A failure here changes the model's input, so it must be recorded rather
    // than swallowed — the pair is no longer canonical preprocessing.
    try {
      const harmonized = await harmonizePairLighting(beforeBase64, afterBase64);
      comparisonBeforeBase64 = harmonized.beforeBase64;
      comparisonAfterBase64 = harmonized.afterBase64;
    } catch (error) {
      throw new Error(
        "Lighting harmonization failed; refusing to score under non-canonical preprocessing: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Mirrors scripts/score_pairs.py exactly: same rubric, same system
      // prompt, same image order, temperature 0.
      const response = await anthropicClient().messages.create({
        model: VISION_MODEL,
        max_tokens: 1500,
        temperature: 0,
        system: rubricSpec.prompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: rubricSpec.userTurnText },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: comparisonBeforeBase64,
                },
              },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: comparisonAfterBase64,
                },
              },
            ],
          },
        ],
      });

      const rawText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawText;

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new Error(`Vision rubric returned non-JSON: ${rawText.slice(0, 500)}`);
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Vision rubric returned a non-object payload");
      }

      const normalized = normalizeResponse(parsed as Record<string, unknown>);

      // Range violations mean the model ignored the scale; that is a bad
      // response to retry, not a value to clamp into the valid range.
      const result = pairMetricsSchema.safeParse(normalized);
      if (!result.success) {
        throw new Error(`Vision rubric JSON validation failed: ${result.error.message}`);
      }

      const violations = findSelfConsistencyViolations(result.data);
      if (violations.length > 0) {
        if (attempt < maxAttempts) {
          throw new Error(`Self-inconsistent response: ${violations.join("; ")}`);
        }
        warnings.push(
          `Self-consistency violations persisted after ${maxAttempts} attempts: ${violations.join("; ")}`,
        );
      }

      if (attempt > 1) {
        warnings.push(`Scored on attempt ${attempt} of ${maxAttempts}.`);
      }

      return {
        metrics: result.data,
        rawText,
        modelId: VISION_MODEL,
        rubricVersion: rubricSpec.rubricVersion,
        warnings,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt)));
      }
    }
  }

  throw new Error(
    `Vision rubric failed after ${maxAttempts} attempts: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}
