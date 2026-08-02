import { storage } from "./storage";
import {
  aggregateByMetric,
  rankInterventions,
  type InterventionRow,
} from "./cohort-stats";
import { loadCohortReference } from "./cohort-reference";
import { getVisionModelId } from "./vision-rubric";
import { pairMetricsSchema } from "@shared/cohort-metrics";
import type { Photo } from "@shared/schema";

/**
 * Label + demographics + timing role (before/after). No image URLs or base64.
 *
 * Null on a demographic field means it was not determined. Consumers must
 * render N/A; there is no default to fall back to. Ethnicity is absent by
 * design — see migrations/0002_drop_fabricated_ethnicity.sql.
 */
function exportPhotoSlot(photoId: string, lookup: Photo | undefined): {
  locationCode: string | null;
  shortId: string;
  beforeAfter: string | null;
  demographics: {
    initials: string | null;
    gender: string | null;
    ageRange: string | null;
  };
} {
  const shortId = photoId.slice(0, 8);
  const emptyDemo = {
    initials: null as string | null,
    gender: null as string | null,
    ageRange: null as string | null,
  };
  if (!lookup) {
    return {
      locationCode: null,
      shortId,
      beforeAfter: null,
      demographics: emptyDemo,
    };
  }
  return {
    locationCode: lookup.locationCode ?? null,
    shortId,
    beforeAfter: lookup.beforeAfter ?? null,
    demographics: {
      initials: lookup.initials ?? null,
      gender: lookup.gender ?? null,
      ageRange: lookup.ageRange ?? null,
    },
  };
}

function exportAfterPhoto(
  photoId: string,
  photo: Photo | undefined,
  studyContext: { weeksAfter: number | null; interventionLabel: string | null } | undefined,
) {
  return {
    ...exportPhotoSlot(photoId, photo),
    weeksAfter: studyContext?.weeksAfter ?? null,
    interventionLabel: studyContext?.interventionLabel ?? null,
  };
}

export async function buildStudyExportBundle(userId: string, studyId: string) {
  const study = await storage.getStudyForUser(studyId, userId);
  if (!study) {
    throw new Error("Study not found");
  }

  const membersRaw = await storage.getStudyPhotosWithPhotos(studyId);
  const photoById = new Map<string, Photo>();
  const studyContextByPhotoId = new Map<
    string,
    { weeksAfter: number | null; interventionLabel: string | null }
  >();
  for (const m of membersRaw) {
    photoById.set(m.photo.id, m.photo);
    studyContextByPhotoId.set(m.photo.id, {
      weeksAfter: m.studyPhoto.weeksAfter ?? null,
      interventionLabel: m.studyPhoto.interventionLabel ?? null,
    });
  }

  const members = membersRaw.map((m) => ({
    studyPhoto: {
      role: m.studyPhoto.role,
      weeksAfter: m.studyPhoto.weeksAfter ?? null,
      interventionLabel: m.studyPhoto.interventionLabel ?? null,
      sortOrder: m.studyPhoto.sortOrder,
    },
    photo: exportPhotoSlot(m.photo.id, m.photo),
  }));

  const analyses = await storage.getPairAnalysesForStudy(studyId);
  const interventionRows: InterventionRow[] = [];

  for (const a of analyses) {
    const meta = await storage.getStudyMemberByPhoto(studyId, a.afterPhotoId);
    const metricsParse = pairMetricsSchema.safeParse(a.metrics);
    if (!metricsParse.success) continue;

    interventionRows.push({
      afterPhotoId: a.afterPhotoId,
      interventionLabel: meta?.interventionLabel ?? null,
      weeksAfter: meta?.weeksAfter ?? null,
      metrics: metricsParse.data,
    });
  }

  const { reference, loadError } = loadCohortReference();
  const aggregates = aggregateByMetric(interventionRows);
  const interventionRankings = rankInterventions(interventionRows, reference, getVisionModelId());

  const pairwiseMetrics = analyses.map((row) => {
    const parsed = pairMetricsSchema.safeParse(row.metrics);
    const afterCtx = studyContextByPhotoId.get(row.afterPhotoId);
    return {
      beforePhoto: exportPhotoSlot(row.beforePhotoId, photoById.get(row.beforePhotoId)),
      afterPhoto: exportAfterPhoto(
        row.afterPhotoId,
        photoById.get(row.afterPhotoId),
        afterCtx,
      ),
      metrics: parsed.success ? parsed.data : row.metrics,
      landmarkMetrics: row.landmarkMetrics ?? null,
      provenance: row.provenance ?? null,
      improvementScore: row.improvementScore ?? null,
    };
  });

  return {
    exportVersion: "3.0.0",
    exportedAt: new Date().toISOString(),
    /** What every score in this bundle was produced against. */
    scoringBasis: reference
      ? {
          referenceVersion: reference.referenceVersion,
          sampleSize: reference.sampleSize,
          rubricVersion: reference.rubricVersion,
          preprocessingVersion: reference.preprocessingVersion,
          modelId: reference.modelId,
        }
      : null,
    scoringNotice: reference ? null : loadError,
    study: {
      id: study.id,
      title: study.title,
    },
    members,
    cohort: {
      sampleSize: interventionRows.length,
      aggregates,
      interventionRankings,
      pairs: interventionRows.map((r) => ({
        afterPhoto: exportAfterPhoto(
          r.afterPhotoId,
          photoById.get(r.afterPhotoId),
          studyContextByPhotoId.get(r.afterPhotoId),
        ),
        metrics: r.metrics,
      })),
    },
    pairwiseMetrics,
  };
}

export type StudyExportBundle = Awaited<ReturnType<typeof buildStudyExportBundle>>;

export async function buildAllStudiesExportBundle(userId: string) {
  const studies = await storage.listStudies(userId);
  const bundles: StudyExportBundle[] = [];
  for (const row of studies) {
    try {
      bundles.push(await buildStudyExportBundle(userId, row.id));
    } catch {
      // Skip studies that fail to export (deleted mid-request, etc.)
    }
  }
  return {
    exportVersion: "3.0.0",
    exportedAt: new Date().toISOString(),
    scope: "all-cohort-studies",
    studyCount: bundles.length,
    studies: bundles,
  };
}
