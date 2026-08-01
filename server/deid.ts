import { processImageForFaceAnonymization } from "./face-processor";
import { processImageForFaceAnonymizationOpenAI } from "./openai";

export interface DeIdResult {
  processedImageBase64: string;
  method: "FaceApi" | "OpenAIFallback";
  fallbackReason?: string;
}

export interface DeIdOptions {
  /**
   * Whether the generative fallback may run.
   *
   * That path sends the ORIGINAL, identifiable photograph to a third-party API
   * to be described, then synthesizes a portrait from the description. On
   * patient data that is an outbound disclosure of PHI, and the resulting
   * pixels are invented rather than measured.
   *
   * Defaults to disabled. Opt in explicitly, per call, and only where that
   * disclosure is covered.
   */
  allowGenerativeFallback?: boolean;
}

export async function deIdentifyWithFallback(
  imageBase64: string,
  options: DeIdOptions = {},
): Promise<DeIdResult> {
  const { allowGenerativeFallback = false } = options;

  try {
    const processedImageBase64 = await processImageForFaceAnonymization(imageBase64);
    return { processedImageBase64, method: "FaceApi" };
  } catch (primaryError) {
    const reason =
      primaryError instanceof Error ? primaryError.message : "Primary de-identification failed";

    if (!allowGenerativeFallback) {
      throw new Error(
        "Local de-identification failed and the generative fallback is disabled, so the " +
          `original image was NOT uploaded. Reason: ${reason}`,
      );
    }

    console.warn(
      "Primary de-identification failed. Falling back to the generative path, which uploads " +
        `the ORIGINAL image. Reason: ${reason}`,
    );
    const processedImageBase64 = await processImageForFaceAnonymizationOpenAI(imageBase64);
    return { processedImageBase64, method: "OpenAIFallback", fallbackReason: reason };
  }
}
