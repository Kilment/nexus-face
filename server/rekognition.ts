import { RekognitionClient, DetectFacesCommand, FaceDetail } from "@aws-sdk/client-rekognition";

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

function getEmotion(face: FaceDetail, type: string): number {
  return face.Emotions?.find((e) => e.Type === type)?.Confidence || 0;
}

function getAverageAge(face: FaceDetail): number {
  if (!face.AgeRange) return 0;
  return (face.AgeRange.Low || 0 + (face.AgeRange.High || 0)) / 2;
}

export interface ImprovementResult {
  score: number;
  percentage: number;
  confidenceInterval: {
    low: number;
    high: number;
  };
  demographics?: {
    gender: string;
    ageRange: string;
  };
}

export async function detectDemographics(imageBase64: string): Promise<{ gender: string; ageRange: string } | null> {
  try {
    const buffer = Buffer.from(imageBase64, "base64");
    const command = new DetectFacesCommand({
      Image: { Bytes: buffer },
      Attributes: ["ALL"],
    });
    const result = await rekognitionClient.send(command);
    if (!result.FaceDetails?.length) return null;

    const face = result.FaceDetails[0];
    const gender = face.Gender?.Value || "Unknown";
    const ageLow = face.AgeRange?.Low || 0;
    const ageHigh = face.AgeRange?.High || 0;
    
    return {
      gender,
      ageRange: `${ageLow}-${ageHigh}`,
    };
  } catch (error) {
    console.error("Demographics detection error:", error);
    return null;
  }
}

export async function calculateImprovementScore(beforeBase64: string, afterBase64: string): Promise<ImprovementResult> {
  try {
    const beforeBuffer = Buffer.from(beforeBase64, "base64");
    const afterBuffer = Buffer.from(afterBase64, "base64");

    const detectBefore = new DetectFacesCommand({
      Image: { Bytes: beforeBuffer },
      Attributes: ["ALL"],
    });
    const detectAfter = new DetectFacesCommand({
      Image: { Bytes: afterBuffer },
    });

    const [beforeResult, afterResult] = await Promise.all([
      rekognitionClient.send(detectBefore),
      rekognitionClient.send(detectAfter),
    ]);

    if (!beforeResult.FaceDetails?.length || !afterResult.FaceDetails?.length) {
      return { score: 0, percentage: 0, confidenceInterval: { low: 0, high: 0 } };
    }

    const beforeFace = beforeResult.FaceDetails[0];
    const afterFace = afterResult.FaceDetails[0];

    let rawScore = 50;

    // === AGE APPEARANCE (Highest weight - 35%) ===
    const beforeAge = getAverageAge(beforeFace);
    const afterAge = getAverageAge(afterFace);
    const ageImprovement = beforeAge - afterAge;
    rawScore += ageImprovement * 3.5;

    // === HAPPINESS/SMILE (15%) ===
    const beforeHappy = getEmotion(beforeFace, "HAPPY");
    const afterHappy = getEmotion(afterFace, "HAPPY");
    rawScore += (afterHappy - beforeHappy) * 0.15;

    // === CALMNESS (10%) ===
    const beforeCalm = getEmotion(beforeFace, "CALM");
    const afterCalm = getEmotion(afterFace, "CALM");
    rawScore += (afterCalm - beforeCalm) * 0.1;

    // === REDUCED NEGATIVE EMOTIONS (10%) ===
    const getNegativeEmotions = (face: FaceDetail) => 
      getEmotion(face, "SAD") + getEmotion(face, "ANGRY") + getEmotion(face, "FEAR") + getEmotion(face, "DISGUSTED");
    const beforeNegative = getNegativeEmotions(beforeFace);
    const afterNegative = getNegativeEmotions(afterFace);
    rawScore += (beforeNegative - afterNegative) * 0.025;

    // === SMILE CONFIDENCE (10%) ===
    const beforeSmile = beforeFace.Smile?.Value ? beforeFace.Smile.Confidence || 0 : 0;
    const afterSmile = afterFace.Smile?.Value ? afterFace.Smile.Confidence || 0 : 0;
    rawScore += (afterSmile - beforeSmile) * 0.1;

    // === IMAGE QUALITY (10%) ===
    const beforeQuality = (beforeFace.Quality?.Brightness || 0) + (beforeFace.Quality?.Sharpness || 0);
    const afterQuality = (afterFace.Quality?.Brightness || 0) + (afterFace.Quality?.Sharpness || 0);
    rawScore += (afterQuality - beforeQuality) * 0.05;

    // === EYES OPEN (5%) ===
    const beforeEyes = beforeFace.EyesOpen?.Value ? beforeFace.EyesOpen.Confidence || 0 : 0;
    const afterEyes = afterFace.EyesOpen?.Value ? afterFace.EyesOpen.Confidence || 0 : 0;
    rawScore += (afterEyes - beforeEyes) * 0.05;

    // === FACE POSE (5%) ===
    const getPoseScore = (face: FaceDetail) => {
      const pitch = Math.abs(face.Pose?.Pitch || 0);
      const yaw = Math.abs(face.Pose?.Yaw || 0);
      const roll = Math.abs(face.Pose?.Roll || 0);
      return (pitch + yaw + roll) / 3;
    };
    const beforePose = getPoseScore(beforeFace);
    const afterPose = getPoseScore(afterFace);
    rawScore += (beforePose - afterPose) * 0.5;

    const clampedScore = Math.max(0, Math.min(100, rawScore));
    
    // Convert to percentage via log scale
    // We treat 50 as 0% improvement. 100 as roughly 100% improvement.
    // Formula: percentage = ln(score / 50) * 144.27 (where 144.27 makes ln(2) = 100)
    let percentage = 0;
    if (clampedScore > 0) {
      percentage = Math.round(Math.log(clampedScore / 50) * 144.27);
    }

    // Confidence interval calculation (simulated based on Rekognition confidence scores)
    const avgConfidence = (beforeFace.Confidence || 95 + (afterFace.Confidence || 95)) / 2;
    const margin = Math.max(2, Math.round((100 - avgConfidence) * 0.5));
    
    return {
      score: Math.round(clampedScore),
      percentage,
      confidenceInterval: {
        low: percentage - margin,
        high: percentage + margin
      }
    };
  } catch (error) {
    console.error("Rekognition error:", error);
    return { score: 0, percentage: 0, confidenceInterval: { low: 0, high: 0 } };
  }
}
