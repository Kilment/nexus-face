# Frozen cohort reference

`cohort-reference.json` holds the fixed per-domain mean/sd and composite
distribution that every scored pair is standardized against. The server loads
it at `server/cohort-reference.ts`; override the path with
`COHORT_REFERENCE_PATH`.

**It is deliberately a checked-in artifact, not a live query.** Standardizing
against the current table would mean a new photo pair could not be scored
without the whole cohort present, and every insertion would retroactively
change previously reported scores.

A reference records the rubric, preprocessing and model it was built under.
Scoring refuses to emit a number when a pair's provenance does not match,
because a z-score against a differently-produced distribution is meaningless.

## Rebuilding

Change any of these and the reference must be rebuilt, and prior scores are no
longer comparable: the rubric, the preprocessing, or the model snapshot.

```bash
# 1. Canonical preprocessing (de-id -> 512x512 standardize)
npx tsx scripts/standardize-cohort.ts \
    --photos-dir "/path/to/Photos" --out-dir "/path/to/Photos_std"

# 2. Score every pair
export ANTHROPIC_API_KEY=sk-ant-...
python3 scripts/score_pairs.py \
    --standardized-dir "/path/to/Photos_std" --out scripts/results.csv

# 3. Freeze the reference
python3 scripts/build_cohort_reference.py \
    --csv scripts/results.csv --out scripts/reference/cohort-reference.json

# 4. Apply it back to the CSV
python3 scripts/compute_improvement_score.py \
    --csv scripts/results.csv --reference scripts/reference/cohort-reference.json
```

## Before trusting any of it

```bash
python3 scripts/validate_pipeline.py \
    --standardized-dir "/path/to/Photos_std" \
    --out scripts/reference/validation-report.json
```

Runs three controls with known answers: repeat the same pair (expect SD 0),
score an image against itself (expect all deltas 0), and swap image order
(expect deltas to negate). The null-pair and order-swap results are the
honest bounds on what this pipeline can claim.
