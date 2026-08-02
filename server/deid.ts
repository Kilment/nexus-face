import { processImageForFaceAnonymization } from "./face-processor";

export interface DeIdResult {
  processedImageBase64: string;
  method: "FaceApi";
}

/**
 * De-identify a face photograph locally.
 *
 * There is deliberately no remote fallback. The previous implementation, when
 * local detection failed, uploaded the ORIGINAL identifiable photograph to a
 * third-party API to be described and then synthesized a replacement portrait.
 * That was an outbound disclosure of PHI, and it produced invented pixels that
 * were then measured as if they were the patient.
 *
 * Local detection now either succeeds or throws. A photograph that cannot be
 * de-identified here never leaves this machine.
 */
export async function deIdentifyWithFallback(imageBase64: string): Promise<DeIdResult> {
  const processedImageBase64 = await processImageForFaceAnonymization(imageBase64);
  return { processedImageBase64, method: "FaceApi" };
}
