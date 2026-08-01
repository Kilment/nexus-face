/**
 * Run the cohort's raw photos through CANONICAL preprocessing — the same
 * de-identification and standardization code the app applies to a new photo —
 * and write the results plus a provenance manifest.
 *
 * Why this exists: the batch scorer used to send raw camera files to the model
 * while the app sent de-identified, 512x512-standardized, lighting-harmonized
 * images. Those are different input distributions, so cohort statistics derived
 * from one could not legitimately standardize a score produced by the other.
 * Everything now goes through this step first.
 *
 * Usage:
 *   npx tsx scripts/standardize-cohort.ts \
 *     --photos-dir "/path/to/Photos" \
 *     --out-dir "/path/to/Photos_standardized"
 *
 *   # Optional:
 *   #   --manifest <path>        (defaults to photos-dir/manifest.json)
 *   #   --allow-generative-deid  (include images that needed the generative
 *   #                             de-id fallback; excluded by default)
 *   #   --force                  (re-standardize images already present)
 */

import * as fs from "fs";
import * as path from "path";
import { deIdentifyWithFallback } from "../server/deid";
import { standardizePhoto } from "../server/photo-standardizer";
import {
  PREPROCESSING_VERSION_DETERMINISTIC,
  PREPROCESSING_VERSION_AI_GUIDED,
} from "../shared/cohort-metrics";

interface ManifestPhoto {
  role: string;
  relativePath: string;
  weeksAfter?: number | null;
}

interface ManifestCohort {
  folder: string;
  studyTitle?: string;
  initials?: string;
  locationCode?: string;
  photos: ManifestPhoto[];
}

interface PreprocessedRecord {
  folder: string;
  studyTitle: string;
  initials: string;
  locationCode: string;
  role: string;
  sourcePath: string;
  outputPath: string;
  deIdMethod: "FaceApi" | "OpenAIFallback";
  /** True when de-id fell back to the generative path, i.e. pixels were synthesized. */
  generativeDeIdUsed: boolean;
  fallbackReason?: string;
  weeksAfter: number | null;
}

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/** Mirror score_pairs.py's tolerance for messy folder/file naming. */
function resolvePhotoPath(folder: string, relativePath: string): string | null {
  const parts = relativePath.split("/");
  const fname = (parts.length > 1 ? parts.slice(1).join("/") : relativePath).trim();

  const candidates = new Set<string>([fname]);
  const m = fname.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(\..+)$/);
  if (m) {
    const [, mm, dd, yy, ext] = m;
    for (const mv of new Set([mm!, mm!.replace(/^0+/, "") || "0", mm!.padStart(2, "0")])) {
      for (const dv of new Set([dd!, dd!.replace(/^0+/, "") || "0", dd!.padStart(2, "0")])) {
        candidates.add(`${mv}.${dv}.${yy}${ext}`);
      }
    }
  }

  for (const c of candidates) {
    const p = path.join(folder, c);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function buildFolderIndex(photosDir: string): Map<string, string> {
  const idx = new Map<string, string>();
  for (const entry of fs.readdirSync(photosDir, { withFileTypes: true })) {
    if (entry.isDirectory()) idx.set(entry.name.trim(), path.join(photosDir, entry.name));
  }
  return idx;
}

async function main(): Promise<number> {
  const args = parseArgs();
  const photosDir = args["photos-dir"];
  const outDir = args["out-dir"];

  if (typeof photosDir !== "string" || typeof outDir !== "string") {
    console.error("Usage: tsx scripts/standardize-cohort.ts --photos-dir <dir> --out-dir <dir>");
    return 1;
  }

  const allowGenerative = args["allow-generative-deid"] === true;
  // Deterministic by default: no vision model, no API key, byte-reproducible.
  const aiGuided = args["ai-guided-standardization"] === true;
  const preprocessingVersion = aiGuided
    ? PREPROCESSING_VERSION_AI_GUIDED
    : PREPROCESSING_VERSION_DETERMINISTIC;
  const force = args["force"] === true;
  const manifestPath =
    typeof args.manifest === "string" ? args.manifest : path.join(photosDir, "manifest.json");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    cohorts: ManifestCohort[];
  };
  const folderIdx = buildFolderIndex(photosDir);
  fs.mkdirSync(outDir, { recursive: true });

  const records: PreprocessedRecord[] = [];
  const skipped: Array<{ folder: string; relativePath?: string; reason: string }> = [];
  let generativeCount = 0;

  for (const cohort of manifest.cohorts) {
    const actualFolder = folderIdx.get(cohort.folder.trim());
    if (!actualFolder) {
      skipped.push({ folder: cohort.folder, reason: "folder_not_on_disk" });
      continue;
    }

    const cohortOutDir = path.join(outDir, cohort.folder.trim());
    fs.mkdirSync(cohortOutDir, { recursive: true });

    for (const photo of cohort.photos) {
      const sourcePath = resolvePhotoPath(actualFolder, photo.relativePath);
      if (!sourcePath) {
        skipped.push({
          folder: cohort.folder,
          relativePath: photo.relativePath,
          reason: "file_missing",
        });
        continue;
      }

      const outputPath = path.join(
        cohortOutDir,
        `${path.basename(sourcePath, path.extname(sourcePath))}.standardized.png`,
      );

      if (!force && fs.existsSync(outputPath)) {
        console.log(`SKIP (exists) ${cohort.folder}/${path.basename(sourcePath)}`);
        continue;
      }

      try {
        const rawBase64 = fs.readFileSync(sourcePath).toString("base64");
        const deid = await deIdentifyWithFallback(rawBase64, {
          allowGenerativeFallback: allowGenerative,
        });
        const generative = deid.method === "OpenAIFallback";

        if (generative) {
          generativeCount++;
          if (!allowGenerative) {
            // The generative fallback synthesizes a portrait. Predicting age
            // from invented pixels is not a measurement of this patient, so
            // these are excluded unless explicitly opted in.
            skipped.push({
              folder: cohort.folder,
              relativePath: photo.relativePath,
              reason: `generative_deid_fallback (${deid.fallbackReason ?? "unknown"})`,
            });
            console.warn(
              `EXCLUDE ${cohort.folder}/${path.basename(sourcePath)} — de-id fell back to the ` +
                "generative path; pixels would be synthesized. Pass --allow-generative-deid to override.",
            );
            continue;
          }
        }

        const standardized = await standardizePhoto(
          deid.processedImageBase64,
          aiGuided ? "ai-guided" : "deterministic",
        );
        fs.writeFileSync(outputPath, Buffer.from(standardized, "base64"));

        records.push({
          folder: cohort.folder.trim(),
          studyTitle: cohort.studyTitle ?? "",
          initials: cohort.initials ?? "",
          locationCode: cohort.locationCode ?? "",
          role: photo.role,
          sourcePath,
          outputPath,
          deIdMethod: deid.method,
          generativeDeIdUsed: generative,
          fallbackReason: deid.fallbackReason,
          weeksAfter: photo.weeksAfter ?? null,
        });

        console.log(
          `OK   ${cohort.folder}/${path.basename(sourcePath)} -> ${path.basename(outputPath)} ` +
            `(deid=${deid.method})`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        skipped.push({ folder: cohort.folder, relativePath: photo.relativePath, reason });
        console.error(`FAIL ${cohort.folder}/${path.basename(sourcePath)}: ${reason}`);
      }
    }
  }

  const outManifest = {
    preprocessingVersion,
    generatedAt: new Date().toISOString(),
    sourceManifest: manifestPath,
    sourcePhotosDir: photosDir,
    allowGenerativeDeId: allowGenerative,
    counts: {
      standardized: records.length,
      skipped: skipped.length,
      generativeDeId: generativeCount,
    },
    records,
    skipped,
  };

  const outManifestPath = path.join(outDir, "preprocessing-manifest.json");
  fs.writeFileSync(outManifestPath, JSON.stringify(outManifest, null, 2));

  console.log(
    `\nStandardized ${records.length}, skipped ${skipped.length}. Manifest: ${outManifestPath}`,
  );
  if (generativeCount > 0) {
    console.log(
      `${generativeCount} image(s) hit the generative de-id fallback` +
        (allowGenerative ? " and were INCLUDED (--allow-generative-deid)." : " and were excluded."),
    );
  }

  return skipped.length > 0 ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
