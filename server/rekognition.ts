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

export async function calculateImprovementScore(beforeBase64: string, afterBase64: string): Promise<number> {
  try {
    const beforeBuffer = Buffer.from(beforeBase64, "base64");
    const afterBuffer = Buffer.from(afterBase64, "base64");

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

    let score = 50;

    // === AGE APPEARANCE (Highest weight - 35%) ===
    // Looking younger in "after" photo = improvement
    const beforeAge = getAverageAge(beforeFace);
    const afterAge = getAverageAge(afterFace);
    const ageImprovement = beforeAge - afterAge; // Positive = looks younger
    score += ageImprovement * 3.5; // Up to +/- 35 points

    // === HAPPINESS/SMILE (15%) ===
    const beforeHappy = getEmotion(beforeFace, "HAPPY");
    const afterHappy = getEmotion(afterFace, "HAPPY");
    score += (afterHappy - beforeHappy) * 0.15;

    // === CALMNESS (10%) ===
    const beforeCalm = getEmotion(beforeFace, "CALM");
    const afterCalm = getEmotion(afterFace, "CALM");
    score += (afterCalm - beforeCalm) * 0.1;

    // === REDUCED NEGATIVE EMOTIONS (10%) ===
    const getNegativeEmotions = (face: FaceDetail) => 
      getEmotion(face, "SAD") + getEmotion(face, "ANGRY") + getEmotion(face, "FEAR") + getEmotion(face, "DISGUSTED");
    const beforeNegative = getNegativeEmotions(beforeFace);
    const afterNegative = getNegativeEmotions(afterFace);
    score += (beforeNegative - afterNegative) * 0.025; // Reduction is good

    // === SMILE CONFIDENCE (10%) ===
    const beforeSmile = beforeFace.Smile?.Value ? beforeFace.Smile.Confidence || 0 : 0;
    const afterSmile = afterFace.Smile?.Value ? afterFace.Smile.Confidence || 0 : 0;
    score += (afterSmile - beforeSmile) * 0.1;

    // === IMAGE QUALITY (10%) ===
    const beforeQuality = (beforeFace.Quality?.Brightness || 0) + (beforeFace.Quality?.Sharpness || 0);
    const afterQuality = (afterFace.Quality?.Brightness || 0) + (afterFace.Quality?.Sharpness || 0);
    score += (afterQuality - beforeQuality) * 0.05;

    // === EYES OPEN (5%) ===
    const beforeEyes = beforeFace.EyesOpen?.Value ? beforeFace.EyesOpen.Confidence || 0 : 0;
    const afterEyes = afterFace.EyesOpen?.Value ? afterFace.EyesOpen.Confidence || 0 : 0;
    score += (afterEyes - beforeEyes) * 0.05;

    // === FACE POSE - More centered/confident (5%) ===
    const getPoseScore = (face: FaceDetail) => {
      const pitch = Math.abs(face.Pose?.Pitch || 0);
      const yaw = Math.abs(face.Pose?.Yaw || 0);
      const roll = Math.abs(face.Pose?.Roll || 0);
      return (pitch + yaw + roll) / 3;
    };
    const beforePose = getPoseScore(beforeFace);
    const afterPose = getPoseScore(afterFace);
    score += (beforePose - afterPose) * 0.5; // Less tilt = more centered = better

    return Math.max(0, Math.min(100, Math.round(score)));
  } catch (error) {
    console.error("Rekognition error:", error);
    return 0;
  }
}
