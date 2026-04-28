import { storage } from "./storage";
import type { Photo } from "@shared/schema";

/**
 * When two photos are linked (before/after), ensure a study exists and run analysis.
 * `scheduleStudyAnalysis` is how the HTTP server runs analysis in the background; scripts can call `analyzeStudy` directly.
 */
export async function runCohortAnalysisForLinkedPair(
  userId: string,
  first: Photo | undefined,
  second: Photo | undefined,
  scheduleStudyAnalysis: (studyId: string, userId: string) => void | Promise<unknown>,
): Promise<string | null> {
  if (!first || !second) return null;
  if (!first.linkedPhotoId || !second.linkedPhotoId) return null;

  const beforePhoto = first.beforeAfter === "before" ? first : second;
  const afterPhoto = first.beforeAfter === "after" ? first : second;
  if (beforePhoto.beforeAfter !== "before" || afterPhoto.beforeAfter !== "after") return null;

  const existing = await storage.getPairAnalysisForAfterPhoto(userId, afterPhoto.id);
  const existingStudyForPair = await storage.findStudyForPhotoPair(
    userId,
    beforePhoto.id,
    afterPhoto.id,
  );
  const studyId =
    existing?.studyId ??
    existingStudyForPair?.id ??
    (
      await storage.createStudy({
        userId,
        title: `${beforePhoto.initials} Cohort Study`,
      })
    ).id;

  await storage.replaceStudyMembers(studyId, [
    {
      photoId: beforePhoto.id,
      role: "before",
      weeksAfter: null,
      interventionLabel: null,
      sortOrder: 0,
    },
    {
      photoId: afterPhoto.id,
      role: "after",
      weeksAfter: afterPhoto.weeksAfter ?? null,
      interventionLabel: null,
      sortOrder: 1,
    },
  ]);

  await scheduleStudyAnalysis(studyId, userId);
  return studyId;
}
