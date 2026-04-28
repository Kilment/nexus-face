/**
 * Import a zip archive into a user's account using the same pipeline as in-app import
 * (manifest → de-ID → standardize → demographics → photos table; links + study analysis when pairs match).
 *
 * Usage (from repo root, DATABASE_URL set):
 *   npx tsx scripts/import-zip-for-user.ts /path/to/archive.zip test@gmail.com
 *
 * Place the zip in the workspace or use an absolute path, then run on the machine that can reach the DB
 * (e.g. Replit shell with secrets loaded).
 */
import fs from "node:fs";
import path from "node:path";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { importZipBufferForUser, ZipImportValidationError } from "../server/zipImportService";
import { analyzeStudy } from "../server/study-analysis";

const zipPath = process.argv[2];
const email = process.argv[3] ?? "test@gmail.com";

async function main() {
  if (!zipPath) {
    console.error("Usage: npx tsx scripts/import-zip-for-user.ts <path-to.zip> [email]");
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), zipPath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const user = await storage.getUserByEmail(email);
  if (!user) {
    console.error(`No user with email: ${email}`);
    process.exit(1);
  }

  const zipBuffer = fs.readFileSync(resolved);
  console.log(`Importing ${resolved} (${zipBuffer.length} bytes) → user ${email} (${user.id})…`);

  try {
    const result = await importZipBufferForUser({
      userId: user.id,
      zipBuffer,
      scheduleStudyAnalysis: (studyId, userId) => {
        void analyzeStudy(studyId, userId).catch((err) => {
          console.error(`analyzeStudy(${studyId}):`, err);
        });
      },
    });

    console.log("Done.");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    if (e instanceof ZipImportValidationError) {
      console.error("Validation error:", e.message, e.body);
      process.exit(1);
    }
    throw e;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  void pool.end();
  process.exit(1);
});
