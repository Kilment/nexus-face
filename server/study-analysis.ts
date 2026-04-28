import { storage } from "./storage";
import { scorePairWithVisionRubric, getVisionModelId } from "./vision-rubric";
import { computeLandmarkMetrics } from "./landmark-metrics";
import { ANALYSIS_VERSION } from "@shared/cohort-metrics";
import type { PairAnalysisRow } from "@shared/schema";
import type { LandmarkMetrics } from "@shared/cohort-metrics";

export interface LandmarkPairPayload {
  before: LandmarkMetrics;
  after: LandmarkMetrics;
  deltaLeftGonialProxyDeg: number;
  deltaRightGonialProxyDeg: number;
  deltaCheekFullnessRatio: number;
  deltaJawWidthToFaceHeightRatio: number;
}

/**
 * Runs hybrid vision rubric + 2D landmark proxies for each after vs the study before image.
 */
export async function analyzeStudy(studyId: string, userId: string): Promise<PairAnalysisRow[]> {
  const study = await storage.getStudyForUser(studyId, userId);
  if (!study) {
    throw new Error("Study not found");
  }

  const joined = await storage.getStudyPhotosWithPhotos(studyId);
  const beforeRow = joined.find((r) => r.studyPhoto.role === "before");
  const afterRows = joined
    .filter((r) => r.studyPhoto.role === "after")
    .sort((a, b) => (a.studyPhoto.sortOrder ?? 0) - (b.studyPhoto.sortOrder ?? 0));

  if (!beforeRow) {
    throw new Error("Study must include exactly one photo with role \"before\"");
  }
  if (afterRows.length === 0) {
    throw new Error("Study must include at least one \"after\" photo");
  }

  const beforeB64 =
    beforeRow.photo.standardizedImageBase64 ?? beforeRow.photo.processedImageBase64 ?? "";
  if (!beforeB64) {
    throw new Error("Before photo missing image data");
  }

  await storage.deletePairAnalysesForStudy(studyId);

  const modelId = getVisionModelId();
  const results: PairAnalysisRow[] = [];

  const beforeLandmarks = await computeLandmarkMetrics(beforeB64);

  for (const row of afterRows) {
    const afterB64 = row.photo.standardizedImageBase64 ?? row.photo.processedImageBase64 ?? "";
    if (!afterB64) continue;

    const { metrics, rawText } = await scorePairWithVisionRubric(beforeB64, afterB64);
    const afterLandmarks = await computeLandmarkMetrics(afterB64);

    const landmarkPayload: LandmarkPairPayload = {
      before: beforeLandmarks,
      after: afterLandmarks,
      deltaLeftGonialProxyDeg: afterLandmarks.leftGonialProxyDeg - beforeLandmarks.leftGonialProxyDeg,
      deltaRightGonialProxyDeg: afterLandmarks.rightGonialProxyDeg - beforeLandmarks.rightGonialProxyDeg,
      deltaCheekFullnessRatio: afterLandmarks.cheekFullnessRatio - beforeLandmarks.cheekFullnessRatio,
      deltaJawWidthToFaceHeightRatio:
        afterLandmarks.jawWidthToFaceHeightRatio - beforeLandmarks.jawWidthToFaceHeightRatio,
    };

    const saved = await storage.createPairAnalysis({
      studyId,
      beforePhotoId: beforeRow.photo.id,
      afterPhotoId: row.photo.id,
      analysisVersion: ANALYSIS_VERSION,
      modelId,
      metrics,
      landmarkMetrics: landmarkPayload,
      rawArtifact: rawText.slice(0, 12000),
    });
    results.push(saved);
  }

  return results;
}
