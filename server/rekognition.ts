import { RekognitionClient, DetectFacesCommand } from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/**
 * Rekognition reports gender with a confidence score. Below this we record
 * nothing rather than a coin-flip label.
 */
const MIN_GENDER_CONFIDENCE = 90;

export interface Demographics {
  /** Rekognition's binary gender *presentation* estimate, or null if absent/low-confidence. */
  gender: string | null;
  /** e.g. "32-40", or null when Rekognition returned no bounded range. */
  ageRange: string | null;
  /** Why a field is null, for logging and audit. Empty when everything resolved. */
  unavailable: string[];
}

const NOTHING_DETECTED: Demographics = {
  gender: null,
  ageRange: null,
  unavailable: ["no face detected"],
};

/**
 * Estimate demographic attributes from a face image.
 *
 * Note on scope: DetectFaces does NOT return race or ethnicity, and this
 * function deliberately exposes no such field. Any ethnicity value would be
 * fabricated. If cohort work needs that variable it has to be collected as
 * recorded metadata, not inferred from pixels.
 *
 * Every field is independently nullable. Null means "not determined" and must
 * render as N/A — callers must not substitute a default.
 */
export async function detectDemographics(imageBase64: string): Promise<Demographics> {
  try {
    const buffer = Buffer.from(imageBase64, "base64");
    const command = new DetectFacesCommand({
      Image: { Bytes: buffer },
      Attributes: ["ALL"],
    });
    const result = await rekognitionClient.send(command);
    if (!result.FaceDetails?.length) return NOTHING_DETECTED;

    const face = result.FaceDetails[0];
    const unavailable: string[] = [];

    let gender: string | null = null;
    if (!face.Gender?.Value) {
      unavailable.push("gender not returned");
    } else if ((face.Gender.Confidence ?? 0) < MIN_GENDER_CONFIDENCE) {
      unavailable.push(
        `gender confidence ${(face.Gender.Confidence ?? 0).toFixed(1)}% below ${MIN_GENDER_CONFIDENCE}%`,
      );
    } else {
      gender = face.Gender.Value;
    }

    // Low/High are independently optional; a partial range is not a range.
    const low = face.AgeRange?.Low;
    const high = face.AgeRange?.High;
    let ageRange: string | null = null;
    if (typeof low === "number" && typeof high === "number") {
      ageRange = `${low}-${high}`;
    } else {
      unavailable.push("age range not returned");
    }

    if (unavailable.length > 0) {
      console.info(`[demographics] recorded as N/A: ${unavailable.join("; ")}`);
    }
    return { gender, ageRange, unavailable };
  } catch (error) {
    // A failed call is not the same as a face with no attributes — say so
    // rather than returning a shape that reads like a successful detection.
    console.error("Demographics detection error:", error);
    return {
      gender: null,
      ageRange: null,
      unavailable: [
        `detection failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
