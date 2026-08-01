import JSZip from "jszip";
import { z } from "zod";
import { storage } from "./storage";
import { deIdentifyWithFallback } from "./deid";
import { standardizePhoto } from "./photo-standardizer";
import { detectDemographics } from "./rekognition";
import { runCohortAnalysisForLinkedPair } from "./cohort-linked-pair";

export class ZipImportValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ZipImportValidationError";
  }
}

/** One row in zip import after normalizing manifest (flat or cohort). */
const zipImportPhotoRowSchema = z.object({
  fileName: z.string().min(1),
  initials: z.string().min(1).max(3),
  beforeAfter: z.enum(["before", "after"]),
  locationCode: z.string().min(1).max(50),
  weeksAfter: z.number().int().nullable().optional(),
});

type ZipImportPhotoRow = z.infer<typeof zipImportPhotoRowSchema>;

const zipManifestCohortSchema = z.object({
  manifestVersion: z.number().optional(),
  cohorts: z.array(
    z.object({
      folder: z.string().min(1),
      studyTitle: z.string().optional(),
      initials: z.string().min(1).max(3),
      locationCode: z.string().min(1).max(50),
      photos: z.array(
        z.object({
          relativePath: z.string().min(1),
          role: z.enum(["before", "after"]),
          weeksAfter: z.number().int().optional(),
        }),
      ),
    }),
  ),
});

function flattenCohortZipManifest(data: z.infer<typeof zipManifestCohortSchema>): ZipImportPhotoRow[] {
  const out: ZipImportPhotoRow[] = [];
  for (const cohort of data.cohorts) {
    for (const photo of cohort.photos) {
      const path = photo.relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
      out.push({
        fileName: path,
        initials: cohort.initials,
        beforeAfter: photo.role,
        locationCode: cohort.locationCode,
        weeksAfter:
          photo.role === "after"
            ? photo.weeksAfter !== undefined
              ? photo.weeksAfter
              : null
            : null,
      });
    }
  }
  return out;
}

function parseZipManifest(
  manifestRaw: string,
):
  | { ok: true; photos: ZipImportPhotoRow[] }
  | { ok: false; zodError?: z.ZodError; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch {
    return { ok: false, message: "Manifest Is Not Valid JSON" };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "cohorts" in parsed &&
    Array.isArray((parsed as { cohorts: unknown }).cohorts)
  ) {
    const result = zipManifestCohortSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, zodError: result.error, message: "Invalid cohort manifest" };
    }
    return { ok: true, photos: flattenCohortZipManifest(result.data) };
  }

  const legacy = z
    .object({
      photos: z.array(zipImportPhotoRowSchema),
    })
    .safeParse(parsed);

  if (!legacy.success) {
    return { ok: false, zodError: legacy.error, message: "Invalid flat manifest (expected photos[])" };
  }

  return { ok: true, photos: legacy.data.photos };
}

function findManifestFileInZip(zip: JSZip): JSZip.JSZipObject | null {
  const tryFile = (path: string): JSZip.JSZipObject | null => {
    const f = zip.file(path);
    return f && !f.dir ? f : null;
  };

  for (const name of ["tags.json", "manifest.json", "Tags.json", "Manifest.json"]) {
    const f = tryFile(name);
    if (f) return f;
  }

  const manifestBasenames = new Set(["tags.json", "manifest.json"]);
  for (const relPath of Object.keys(zip.files)) {
    const meta = zip.files[relPath];
    if (!meta || meta.dir) continue;
    if (relPath.startsWith("__MACOSX/") || relPath.includes("/__MACOSX/")) continue;
    const base = relPath.split("/").pop() ?? "";
    if (manifestBasenames.has(base.toLowerCase())) {
      const f = tryFile(relPath);
      if (f) return f;
    }
  }

  return null;
}

type ResolveZipImageResult =
  | { ok: true; file: JSZip.JSZipObject; usedPath: string }
  | { ok: false; reason: "not_found" | "ambiguous"; duplicatePaths?: string[] };

function resolveImageFileInZip(zip: JSZip, fileName: string): ResolveZipImageResult {
  const norm = fileName.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const tryPath = (p: string): JSZip.JSZipObject | null => {
    const f = zip.file(p);
    return f && !f.dir ? f : null;
  };

  for (const p of [norm, `images/${norm}`]) {
    const f = tryPath(p);
    if (f) return { ok: true, file: f, usedPath: p };
  }

  const base = norm.includes("/") ? (norm.split("/").pop() ?? "") : norm;
  if (base && base !== norm) {
    const f = tryPath(base);
    if (f) return { ok: true, file: f, usedPath: base };
  }

  if (base) {
    const matches: string[] = [];
    for (const relPath of Object.keys(zip.files)) {
      const meta = zip.files[relPath];
      if (!meta || meta.dir) continue;
      if (relPath.startsWith("__MACOSX/") || relPath.includes("/__MACOSX/")) continue;
      if ((relPath.split("/").pop() ?? "") === base) matches.push(relPath);
    }
    if (matches.length === 1) {
      const f = tryPath(matches[0]!);
      if (f) return { ok: true, file: f, usedPath: matches[0]! };
    }
    if (matches.length > 1) {
      return { ok: false, reason: "ambiguous", duplicatePaths: matches };
    }
  }

  return { ok: false, reason: "not_found" };
}

export type ZipImportResult = {
  importedCount: number;
  skippedCount: number;
  skipped: Array<{ fileName: string; reason: string }>;
  importedIds: string[];
};

export type ZipImportOptions = {
  userId: string;
  zipBuffer: Buffer;
  /** Optional (server passes metrics-aware logger). */
  logDeIdMethod?: (context: string, method: "FaceApi" | "OpenAIFallback", extra?: string) => void;
  scheduleStudyAnalysis: (studyId: string, userId: string) => void | Promise<unknown>;
};

/**
 * Shared by HTTP `/api/photos/import-zip` and `scripts/import-zip-for-user.ts`.
 * Tags come from the manifest (initials, before/after, locationCode, weeksAfter).
 */
export async function importZipBufferForUser(options: ZipImportOptions): Promise<ZipImportResult> {
  const { userId, zipBuffer, logDeIdMethod, scheduleStudyAnalysis } = options;

  if (!zipBuffer?.length) {
    throw new ZipImportValidationError("Empty zip file");
  }

  const zip = await JSZip.loadAsync(zipBuffer);
  const manifestFile = findManifestFileInZip(zip);

  if (!manifestFile) {
    throw new ZipImportValidationError(
      "Missing manifest",
      400,
      {
        hint:
          "Include tags.json or manifest.json (cohorts or photos[]) in the zip. If you zipped a folder, put the manifest inside that folder — we match tags.json/manifest.json anywhere except __MACOSX.",
      },
    );
  }

  const manifestRaw = await manifestFile.async("string");
  const manifestParsed = parseZipManifest(manifestRaw);

  if (!manifestParsed.ok) {
    throw new ZipImportValidationError("Invalid Manifest Format", 400, {
      message: manifestParsed.message,
      ...(manifestParsed.zodError ? { details: manifestParsed.zodError.flatten() } : {}),
    });
  }

  const imported: string[] = [];
  const skipped: Array<{ fileName: string; reason: string }> = [];

  for (const item of manifestParsed.photos) {
    const resolved = resolveImageFileInZip(zip, item.fileName);
    if (!resolved.ok) {
      skipped.push({
        fileName: item.fileName,
        reason:
          resolved.reason === "ambiguous"
            ? "Multiple images share this file name in the zip — use unique paths in the manifest"
            : "File Not Found In Zip",
      });
      continue;
    }

    const ext = resolved.usedPath.toLowerCase().split(".").pop() ?? "";
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
      skipped.push({ fileName: item.fileName, reason: "Unsupported Image Format" });
      continue;
    }

    const rawImageBase64 = await resolved.file.async("base64");
    const deidResult = await deIdentifyWithFallback(rawImageBase64);
    logDeIdMethod?.(
      `ZipImport:${item.fileName}`,
      deidResult.method,
      deidResult.fallbackReason ? `FallbackReason=${deidResult.fallbackReason}` : undefined,
    );
    const standardizedImageBase64 = await standardizePhoto(deidResult.processedImageBase64);
    const demographics = await detectDemographics(standardizedImageBase64);

    const photo = await storage.createPhoto({
      userId,
      processedImageUrl: `data:image/png;base64,${deidResult.processedImageBase64}`,
      processedImageBase64: deidResult.processedImageBase64,
      standardizedImageBase64,
      initials: item.initials.toUpperCase(),
      beforeAfter: item.beforeAfter,
      locationCode: item.locationCode,
      gender: demographics.gender,
      ageRange: demographics.ageRange,
      weeksAfter: item.beforeAfter === "after" ? item.weeksAfter ?? null : null,
    });

    const linkablePhotos = await storage.getLinkablePhotos(userId, photo.initials, photo.beforeAfter, photo.id);

    if (linkablePhotos.length > 0) {
      const targetPhoto = linkablePhotos.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      if (targetPhoto) {
        await storage.updatePhotoLink(photo.id, targetPhoto.id);
        await storage.updatePhotoLink(targetPhoto.id, photo.id);
        await runCohortAnalysisForLinkedPair(
          userId,
          await storage.getPhoto(photo.id),
          await storage.getPhoto(targetPhoto.id),
          scheduleStudyAnalysis,
        );
      }
    }

    imported.push(photo.id);
  }

  return {
    importedCount: imported.length,
    skippedCount: skipped.length,
    skipped,
    importedIds: imported,
  };
}
