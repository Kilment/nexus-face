# Frozen Cohort Reference

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

## The Shipped Reference

`cohort-reference.json` is built from a 134-pair clinical cohort (65 subjects,
IRB-approved), scored with `claude-opus-4-5-20251101` under rubric 1.1.0 and
preprocessing `deid+standardize512-deterministic@1.1.0`, with order-balanced
scoring on.

It contains only aggregate statistics plus 134 unlabelled composite scores. No
subject identifiers of any kind.

### What Validation Found

See `validation-report.json` (redacted summary).

| Control | Result |
|---|---|
| Null pair — image vs itself | Every field exactly 0.000. No fabricated change. |
| Repeatability — 3 runs/pair | ΔAge SD 0.29 years. That is the noise floor. |
| Order swap — before/after reversed | **Failed.** The model rates whichever image it sees second as improved, across every field. |

The order-swap failure is why `score_pairs.py` counterbalances by default: each
pair is scored both ways and antisymmetrized, `(forward - reverse) / 2`, which
cancels a constant position bias exactly. The per-pair bias estimate is kept in
the `positionBiasAge` column.

**Do not disable `--order-balanced` for a cohort you intend to report.**
Uncorrected, this bias inflates every metric in the improvement direction, and
"after" is always the second image.

### Interpreting ΔAge From This Cohort

Counterbalanced, the cohort mean is **-1.16 years** (median -0.5, SD 2.78);
54% of pairs scored younger, 16% unchanged, 31% older. An earlier uncorrected
run on raw photos reported a mean of -2.27 and median of -4.0, with 74% younger.
The gap comes from both the position-bias correction and the change to
de-identified, standardized inputs.

Given a 0.29-year noise floor, individual differences under ~0.5 years should
not be read as real.

## Before Trusting Any of It

```bash
python3 scripts/validate_pipeline.py \
    --standardized-dir "/path/to/Photos_std" \
    --out scripts/reference/validation-report.json
```

Runs three controls with known answers: repeat the same pair (expect SD 0),
score an image against itself (expect all deltas 0), and swap image order
(expect deltas to negate). The null-pair and order-swap results are the
honest bounds on what this pipeline can claim.
