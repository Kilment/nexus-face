import OpenAI from "openai";
import { createCanvas, loadImage } from "canvas";
import { pairMetricsSchema, type PairMetrics } from "@shared/cohort-metrics";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const VISION_MODEL = process.env.COHORT_VISION_MODEL ?? "gpt-4o";

const RUBRIC_PROMPT = `You are assisting with exploratory research image comparison (not clinical diagnosis).
Compare BEFORE (first image) vs AFTER (second image) standardized face portraits.

Score changes as deltas (AFTER minus BEFORE) on these scales where applicable:
- Predicted facial age (years): estimate independently for each image, then set deltas accordingly.
- Wrinkles / subclinical appearance: use a 0–100 severity scale per image; deltas are AFTER minus BEFORE (negative = improvement if lower severity is better).
- Perceived skin firmness, density, facial fullness: each on −50..+50 delta where 0=no change, positive=better firmness/density/fullness appearance.
- Perceived gonial (jaw) angle opening appearance: delta in approximate degrees perception (−10..+10).

Respond ONLY with valid JSON matching this TypeScript shape (numbers only for scored fields):
{
  "predictedFacialAgeBefore": number,
  "predictedFacialAgeAfter": number,
  "deltaPredictedFacialAge": number,
  "deltaSubclinicalWrinkles": number,
  "deltaWrinkles": number,
  "perceivedSkinFirmnessDelta": number,
  "perceivedDensityDelta": number,
  "perceivedFacialFullnessDelta": number,
  "perceivedGonialAngleDelta": number,
  "confidence": number,
  "notes": string
}`;

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

async function harmonizePairLighting(
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

export function getVisionModelId(): string {
  return VISION_MODEL;
}

export async function scorePairWithVisionRubric(
  beforeBase64: string,
  afterBase64: string,
): Promise<{ metrics: PairMetrics; rawText: string }> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error("Vision rubric requires AI_INTEGRATIONS_OPENAI_API_KEY");
  }

  let comparisonBeforeBase64 = beforeBase64;
  let comparisonAfterBase64 = afterBase64;
  try {
    const harmonized = await harmonizePairLighting(beforeBase64, afterBase64);
    comparisonBeforeBase64 = harmonized.beforeBase64;
    comparisonAfterBase64 = harmonized.afterBase64;
  } catch (error) {
    console.warn("Lighting harmonization failed, continuing with original images.", error);
  }

  const response = await openai.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0,
    max_tokens: 800,
    messages: [
      { role: "system", content: RUBRIC_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Image 1 is BEFORE. Image 2 is AFTER." },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${comparisonBeforeBase64}`,
              detail: "high",
            },
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${comparisonAfterBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  });

  const rawText = response.choices[0]?.message?.content ?? "";
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : rawText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Vision rubric returned non-JSON: ${rawText.slice(0, 500)}`);
  }

  const normalizedRecord =
    parsed && typeof parsed === "object" ? { ...(parsed as Record<string, unknown>) } : null;

  if (normalizedRecord) {
    const rawConfidence = normalizedRecord.confidence;
    if (typeof rawConfidence === "number") {
      normalizedRecord.confidence =
        rawConfidence > 1 ? Math.max(0, Math.min(1, rawConfidence / 100)) : Math.max(0, Math.min(1, rawConfidence));
    } else if (typeof rawConfidence === "string") {
      const parsedConfidence = Number(rawConfidence);
      if (Number.isFinite(parsedConfidence)) {
        normalizedRecord.confidence =
          parsedConfidence > 1
            ? Math.max(0, Math.min(1, parsedConfidence / 100))
            : Math.max(0, Math.min(1, parsedConfidence));
      }
    }
  }

  const result = pairMetricsSchema.safeParse(normalizedRecord ?? parsed);
  if (!result.success) {
    throw new Error(`Vision rubric JSON validation failed: ${result.error.message}`);
  }

  return { metrics: result.data, rawText };
}
