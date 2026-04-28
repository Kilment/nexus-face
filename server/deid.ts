import { processImageForFaceAnonymization } from "./face-processor";
import { processImageForFaceAnonymizationOpenAI } from "./openai";

export async function deIdentifyWithFallback(imageBase64: string): Promise<{
  processedImageBase64: string;
  method: "FaceApi" | "OpenAIFallback";
  fallbackReason?: string;
}> {
  try {
    const processedImageBase64 = await processImageForFaceAnonymization(imageBase64);
    return { processedImageBase64, method: "FaceApi" };
  } catch (primaryError) {
    const fallbackReason =
      primaryError instanceof Error ? primaryError.message : "Primary de-identification failed";
    console.warn(`Primary de-identification failed. Using OpenAI fallback. Reason: ${fallbackReason}`);
    const processedImageBase64 = await processImageForFaceAnonymizationOpenAI(imageBase64);
    return { processedImageBase64, method: "OpenAIFallback", fallbackReason };
  }
}
