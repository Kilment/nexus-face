import * as fs from "fs";
import * as path from "path";
import {
  cohortReferenceSchema,
  type CohortReference,
} from "@shared/improvement-score";

/**
 * Loads the frozen cohort reference — the fixed mean/sd per domain and the
 * composite distribution that new pairs are standardized against.
 *
 * Frozen on purpose. Standardizing against the live table would mean a new
 * photo could not be scored without the whole cohort present, and every
 * insertion would retroactively change previously reported scores.
 *
 * Rebuild with: python3 scripts/build_cohort_reference.py
 */

const DEFAULT_REFERENCE_PATH = path.join(
  process.cwd(),
  "scripts",
  "reference",
  "cohort-reference.json",
);

let cached: { reference: CohortReference | null; loadError: string | null } | null = null;

export function loadCohortReference(): {
  reference: CohortReference | null;
  loadError: string | null;
} {
  if (cached) return cached;

  const refPath = process.env.COHORT_REFERENCE_PATH ?? DEFAULT_REFERENCE_PATH;

  if (!fs.existsSync(refPath)) {
    cached = {
      reference: null,
      loadError:
        `No frozen cohort reference at ${refPath}. Improvement scores will report N/A ` +
        "until one is built (scripts/build_cohort_reference.py).",
    };
    console.warn(`[cohort-reference] ${cached.loadError}`);
    return cached;
  }

  try {
    const parsed = cohortReferenceSchema.safeParse(
      JSON.parse(fs.readFileSync(refPath, "utf-8")),
    );
    if (!parsed.success) {
      cached = {
        reference: null,
        loadError: `Cohort reference at ${refPath} is invalid: ${parsed.error.message}`,
      };
      console.error(`[cohort-reference] ${cached.loadError}`);
      return cached;
    }
    console.log(
      `[cohort-reference] Loaded ${parsed.data.referenceVersion} ` +
        `(n=${parsed.data.sampleSize}, rubric ${parsed.data.rubricVersion}, ` +
        `model ${parsed.data.modelId}, preprocessing ${parsed.data.preprocessingVersion})`,
    );
    cached = { reference: parsed.data, loadError: null };
    return cached;
  } catch (error) {
    cached = {
      reference: null,
      loadError: `Failed to read cohort reference at ${refPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
    console.error(`[cohort-reference] ${cached.loadError}`);
    return cached;
  }
}

/** Test/CLI hook — forces the next load to re-read from disk. */
export function resetCohortReferenceCache(): void {
  cached = null;
}
