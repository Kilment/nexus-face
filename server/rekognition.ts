import { RekognitionClient, CompareFacesCommand, DetectFacesCommand } from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function calculateImprovementScore(beforeBase64: string, afterBase64: string): Promise<number> {
  try {
    const beforeBuffer = Buffer.from(beforeBase64, "base64");
    const afterBuffer = Buffer.from(afterBase64, "base64");

    // 1. First, detect faces in both images to get emotional/facial attributes
    const detectBefore = new DetectFacesCommand({
      Image: { Bytes: beforeBuffer },
      Attributes: ["ALL"],
    });
    const detectAfter = new DetectFacesCommand({
      Image: { Bytes: afterBuffer },
      Attributes: ["ALL"],
    });

    const [beforeResult, afterResult] = await Promise.all([
      rekognitionClient.send(detectBefore),
      rekognitionClient.send(detectAfter),
    ]);

    if (!beforeResult.FaceDetails?.length || !afterResult.FaceDetails?.length) {
      return 0;
    }

    const beforeFace = beforeResult.FaceDetails[0];
    const afterFace = afterResult.FaceDetails[0];

    // Score components (0-100)
    // We look for:
    // 1. Smile confidence increase
    // 2. Eyes open confidence
    // 3. Brightness/Sharpness improvement (proxy for "clarity/confidence")
    
    let score = 50; // Baseline

    // Smile factor
    const beforeSmile = beforeFace.Smile?.Value ? beforeFace.Smile.Confidence || 0 : 0;
    const afterSmile = afterFace.Smile?.Value ? afterFace.Smile.Confidence || 0 : 0;
    score += (afterSmile - beforeSmile) * 0.2;

    // Eyes factor
    const beforeEyes = beforeFace.EyesOpen?.Value ? beforeFace.EyesOpen.Confidence || 0 : 0;
    const afterEyes = afterFace.EyesOpen?.Value ? afterFace.EyesOpen.Confidence || 0 : 0;
    score += (afterEyes - beforeEyes) * 0.1;

    // Calmness/Positive emotion shift
    const getHappiness = (face: any) => face.Emotions?.find((e: any) => e.Type === "HAPPY")?.Confidence || 0;
    score += (getHappiness(afterFace) - getHappiness(beforeFace)) * 0.2;

    // Clamp score between 0 and 100
    return Math.max(0, Math.min(100, Math.round(score)));
  } catch (error) {
    console.error("Rekognition error:", error);
    return 0;
  }
}
