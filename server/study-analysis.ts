import { storage } from "./storage";
import { scorePairWithVisionRubric, getVisionModelId, getRubricVersion } from "./vision-rubric";
import { computeLandmarkMetrics } from "./landmark-metrics";
import { loadCohortReference } from "./cohort-reference";
import {
  ANALYSIS_VERSION,
  PREPROCESSING_VERSION,
  type ScoreProvenance,
} from "@shared/cohort-metrics";
import { computeImprovementScore } from "@shared/improvement-score";
import type { PairAnalysisRow } from "@shared/schema";
import type { LandmarkMetrics } from "@shared/cohort-metrics";

export interface LandmarkPairPayload {
  before: LandmarkMetrics;
  after: LandmarkMetrics;
  /** Null whenever either side is null — a missing landmark is not a zero. */
  deltaLeftGonialProxyDeg: number | null;
  deltaRightGonialProxyDeg: number | null;
  deltaCheekFullnessRatio: number | null;
  deltaJawWidthToFaceHeightRatio: number | null;
}

/** Subtract only when both sides exist; otherwise the delta is undetermined. */
function delta(after: number | null, before: number | null): number | null {
  if (after === null || before === null) return null;
  if (!Number.isFinite(after) || !Number.isFinite(before)) return null;
  return after - before;
}

function buildLandmarkPayload(
  before: LandmarkMetrics,
  after: LandmarkMetrics,
): LandmarkPairPayload {
  return {
    before,
    after,
    deltaLeftGonialProxyDeg: delta(after.leftGonialProxyDeg, before.leftGonialProxyDeg),
    deltaRightGonialProxyDeg: delta(after.rightGonialProxyDeg, before.rightGonialProxyDeg),
    deltaCheekFullnessRatio: delta(after.cheekFullnessRatio, before.cheekFullnessRatio),
    deltaJawWidthToFaceHeightRatio: delta(
      after.jawWidthToFaceHeightRatio,
      before.jawWidthToFaceHeightRatio,
    ),
  };
}

export interface StudyAnalysisResult {
  rows: PairAnalysisRow[];
  /** Pairs that could not be scored, with the reason. Never silently dropped. */
  failures: Array<{ afterPhotoId: string; reason: string }>;
  /** Present when improvement scores are unavailable study-wide. */
  scoringNotice: string | null;
}

/**
 * Runs the vision rubric plus 2D landmark proxies for each after-photo against
 * the study's before-photo, then standardizes the result against the frozen
 * cohort reference.
 */
export async function analyzeStudy(
  studyId: string,
  userId: string,
): Promise<StudyAnalysisResult> {
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

  // Only the standardized image is canonical. Falling back to the merely
  // processed image would score the pair under different preprocessing than
  // the reference was built on, making the z-scores meaningless.
  const beforeB64 = beforeRow.photo.standardizedImageBase64;
  if (!beforeB64) {
    throw new Error(
      "Before photo has no standardized image; re-import it so it passes through " +
        `canonical preprocessing (${PREPROCESSING_VERSION}).`,
    );
  }

  await storage.deletePairAnalysesForStudy(studyId);

  const modelId = getVisionModelId();
  const rubricVersion = getRubricVersion();
  const { reference, loadError } = loadCohortReference();
  const results: PairAnalysisRow[] = [];
  const failures: Array<{ afterPhotoId: string; reason: string }> = [];

  const beforeLandmarks = await computeLandmarkMetrics(beforeB64);

  for (const row of afterRows) {
    const afterB64 = row.photo.standardizedImageBase64;
    if (!afterB64) {
      failures.push({
        afterPhotoId: row.photo.id,
        reason: "No standardized image; cannot score under canonical preprocessing.",
      });
      continue;
    }

    try {
      const { metrics, rawText, warnings } = await scorePairWithVisionRubric(
        beforeB64,
        afterB64,
      );
      const afterLandmarks = await computeLandmarkMetrics(afterB64);

      const provenance: ScoreProvenance = {
        rubricVersion,
        analysisVersion: ANALYSIS_VERSION,
        modelId,
        preprocessingVersion: PREPROCESSING_VERSION,
        generativeDeIdUsed: false,
        scoredAt: new Date().toISOString(),
      };

      const improvementScore = computeImprovementScore(metrics, reference, {
        rubricVersion,
        preprocessingVersion: PREPROCESSING_VERSION,
      });

      const saved = await storage.createPairAnalysis({
        studyId,
        beforePhotoId: beforeRow.photo.id,
        afterPhotoId: row.photo.id,
        analysisVersion: ANALYSIS_VERSION,
        modelId,
        metrics,
        landmarkMetrics: buildLandmarkPayload(beforeLandmarks, afterLandmarks),
        provenance,
        improvementScore: { ...improvementScore, warnings },
        rawArtifact: rawText.slice(0, 12000),
      });
      results.push(saved);
    } catch (error) {
      failures.push({
        afterPhotoId: row.photo.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    rows: results,
    failures,
    scoringNotice: reference ? null : loadError,
  };
}
