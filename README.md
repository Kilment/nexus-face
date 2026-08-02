# Nexus

Quantifies apparent facial change between a pre-intervention and a
post-intervention photograph, across predicted age, wrinkle severity by
anatomic sub-region, and perceived volume and jawline definition.

**New here? Start with [WELCOME.md](WELCOME.md)** — how to photograph,
organize, and tag your images, then run the pipeline.

> **Exploratory research tooling. Not a medical device.** No regulatory
> clearance, not validated for diagnosis or treatment decisions. Outputs are
> model estimates of *appearance*, not measurements of tissue.

> **Free for academic and non-commercial use.** Commercial use requires a
> licensing agreement — see [License](#license).

---

## What It Does

A pair of photographs goes through de-identification, standardization to
512×512, and pairwise lighting harmonization. A vision model then scores the
pair against a fixed rubric, and the result is expressed relative to a frozen
cohort reference.

```
before.jpg ─┐
            ├─▶ de-identify ─▶ standardize 512×512 ─▶ harmonize lighting
after.jpg  ─┘                                              │
                                                           ▼
                                                 rubric v1.1 (vision model)
                                                           │
                              ┌────────────────────────────┴──────────────┐
                              ▼                                           ▼
                     absolute measurements                    frozen cohort reference
                  (age, 7 sub-regions, wrinkles,                        │
                   volume, jawline, landmarks)                          ▼
                                                          z-scores → composite → percentile
```

Absolute measurements need no reference. The standardized scores do — and
**a validated reference ships with this repo**, so a fork produces working
z-scores, composites and percentiles on the first pair, with no cohort of its
own. It was built from 134 pairs across 65 subjects (IRB-approved), contains
only aggregate statistics and unlabelled scores, and carries no identifiers.
See [scripts/reference/README.md](scripts/reference/README.md) for how it was
built and what validation found.

---

## Design Principles

**Nothing is fabricated.** Any value that cannot be determined is reported as
`N/A`, never as `0` and never as a default. This holds end to end: absent
demographics, undetected landmarks, empty aggregates, and unscoreable pairs all
surface as `N/A` with a stated reason. There is deliberately no ethnicity field
— the detector does not return race, so any value would be invented.

**One rubric, one definition.** [`shared/rubric.v1.1.json`](shared/rubric.v1.1.json)
is the single source of truth for both the in-app scorer and the batch research
scorer. The server asserts at load that the schema and the rubric have not
drifted apart, and refuses to start if they have.

**Scores carry provenance.** Every score records its rubric version,
preprocessing version, and exact dated model snapshot. A score is only
comparable against a reference produced the same way; on mismatch the pipeline
returns `N/A` with an explanation rather than a meaningless number.

**The reference is frozen, not live.** Standardizing against the current
database would mean a new pair could not be scored without the whole cohort
present, and every insertion would retroactively change previously reported
scores.

**Partial inputs do not yield partial answers.** The Wrinkles domain is the
mean of all seven sub-regions; six of seven is a different estimator, so it
reports `N/A`.

---

## Layout

```
client/          React Native (Expo) app — capture, gallery, pair comparison
server/          Express API, scoring, de-identification, standardization
  rekognition.ts        demographics (nullable; no ethnicity field)
  face-processor.ts     de-identification
  photo-standardizer.ts 512×512 normalization
  vision-rubric.ts      in-app pair scoring
  landmark-metrics.ts   2D geometric proxies
  cohort-reference.ts   frozen reference loader
  tf-backend.ts         TensorFlow WASM initialization
shared/          Types and logic used by both client and server
  rubric.v1.1.json      THE rubric — both scorers read this
  cohort-metrics.ts     schemas; null means N/A
  improvement-score.ts  domain and composite definitions
scripts/         Research pipeline
migrations/      Drizzle SQL migrations
```

## Scripts

| Script | Purpose |
|---|---|
| [`build-reference.sh`](scripts/build-reference.sh) | Runs the four stages below end to end |
| [`standardize-cohort.ts`](scripts/standardize-cohort.ts) | Canonical preprocessing via the app's own code |
| [`score_pairs.py`](scripts/score_pairs.py) | Batch pair scoring, resumable |
| [`build_cohort_reference.py`](scripts/build_cohort_reference.py) | Freezes cohort statistics |
| [`compute_improvement_score.py`](scripts/compute_improvement_score.py) | Applies the reference to a results CSV |
| [`validate_pipeline.py`](scripts/validate_pipeline.py) | Repeatability, null-pair, and order-swap controls |
| [`nexus_pipeline.py`](scripts/nexus_pipeline.py) | Shared primitives mirroring the server |

---

## Quick Start

```bash
npm install
python3 -m pip install --user anthropic pillow numpy
cp .env.example .env.local        # add your Anthropic API key

scripts/build-reference.sh /path/to/photos
```

Full walkthrough, including photo requirements: [WELCOME.md](WELCOME.md).

### Mobile App

```bash
npm run db:push        # apply migrations
npm run server:dev     # API on :5000
npm run expo:dev       # Expo client
```

### Checks

```bash
npm run check:types
npm run lint
```

---

## Versioning

Four versions travel with every score. Changing any of them means previously
reported scores are no longer comparable, and the reference must be rebuilt.

| Version | Defined in | Bump when |
|---|---|---|
| Rubric | `shared/rubric.v1.1.json` | Fields, scales, or prompt change |
| Analysis | `shared/cohort-metrics.ts` | Domain definitions change |
| Preprocessing | `shared/cohort-metrics.ts` | De-id or standardization changes |
| Model | `.env.local` | Always a dated snapshot, never an alias |

---

## Requirements

- Node.js ≥ 20
- Python ≥ 3.9 (`anthropic`, `pillow`, `numpy`)
- PostgreSQL — app only; the research pipeline needs no database
- Anthropic API key — the only key the pipeline needs; both the app and the
  batch scorer use it, so their scores are comparable against the same reference
- AWS Rekognition credentials — optional; without them demographics are `N/A`

Face detection runs on the TensorFlow **WASM** backend. `@tensorflow/tfjs-node`
is deliberately not used: it calls `util.isNullOrUndefined`, removed in Node 23,
and the resulting error escapes even a direct `.catch()`, killing the process.
WASM is slower but runs on every supported Node version.

---

## Handling Patient Data

Photographs of faces are HIPAA-enumerated identifiers, and masking eyes is not
a recognized de-identification method. Before running this on patient
photographs:

- Keep photo directories outside the repo, or at an ignored path
- Use opaque study IDs — no MRNs, names, initials, or dates of service in
  folder or file names
- `scripts/results.csv` is gitignored because it carries subject identifiers
- De-identification is local-only. There is no remote fallback: a photograph
  that cannot be de-identified on this machine never leaves it
- Confirm your own IRB or ethics approval

See [WELCOME.md §9](WELCOME.md#9-handling-patient-data).

---

## License

**Free for academic and non-commercial use. Commercial use requires a
licensing agreement.** See [LICENSE](LICENSE).

This is not an open source license. You may use, modify, and share the Software
for academic research, teaching, personal study, and publication of findings.
Any use directed toward commercial advantage — including within a for-profit
entity, in a product or service offered for a fee, or in fee-generating
clinical practice — needs a separate written agreement. Open an issue to
enquire.

Note the warranty disclaimer: this is exploratory research tooling, not a
medical device, and carries no fitness guarantee for clinical use.
