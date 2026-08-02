# Welcome — Running Nexus On Your Own Photos

This guide takes you from a fresh fork to scored before/after pairs.

Read the [terminology note](#one-thing-to-be-clear-about-first) before you start —
it determines what this pipeline can and cannot tell you.

---

## One thing to be clear about first

**This pipeline does not train a model on your photos.** No weights are fitted,
and nothing learns from your images. Every score comes from a vision model
reading a rubric at inference time.

What your photos *do* build is a **frozen cohort reference**: the mean and
standard deviation of your population, captured once and held fixed. New pairs
are then expressed relative to it. That is normalization, not training — which
matters practically:

| | Training would mean | What actually happens |
|---|---|---|
| More photos | Better predictions | Tighter reference statistics, same predictions |
| Your cohort | Model learns your patients | Model is unchanged; only the comparison baseline is yours |
| Rebuilding | Improves the model | Re-baselines scores; old scores no longer comparable |

So a reference built from 40 dermatology patients and one built from 400
facelift patients yield *differently scaled* scores from the *same* underlying
model. The reference defines "average" for your population. Choose its
contents deliberately.

---

## 1. Prerequisites

- **Node.js ≥ 20** — `node -v`
- **Python ≥ 3.9** — `python3 --version`
- **PostgreSQL** — only for the mobile app; the research pipeline needs no database
- An **Anthropic API key** — the only key needed. Both the app and the batch
  scorer use it, so both produce scores comparable against the same reference.

```bash
git clone <your-fork> && cd nexus-face
npm install
pip install --break-system-packages anthropic pillow numpy
cp .env.example .env.local   # then fill in your keys
```

`.env.local` is gitignored. Never commit real keys.

---

## 2. How to photograph

Everything downstream inherits the quality of this step. The pipeline
normalizes lighting and framing, but it cannot recover information the photo
never captured.

**Hold constant between before and after — this matters more than absolute quality.**
A pair shot under two different setups measures the setup, not the patient.

| Variable | Target |
|---|---|
| Camera & lens | Same device, same focal length |
| Distance | Same; face fills ~60–70% of frame height |
| Angle | Straight-on frontal, camera at eye level |
| Expression | Fully relaxed, neutral, mouth closed, eyes open |
| Lighting | Even and diffuse, front-facing, no directional shadows |
| Background | Plain, uniform, mid-tone |
| Hair | Pulled back off the face, both times |
| Makeup | None, or identical both times |
| Glasses/jewelry | Removed |

**Resolution**: at least 1000 px across the face. Images are standardized to
512×512, so anything beyond ~2000 px adds cost without adding signal.

**Format**: `.jpg`, `.jpeg`, `.png`, or `.webp`.

**Avoid**: smiling (deforms every periorbital and perioral measure), head tilt
or rotation, harsh side lighting (fabricates apparent wrinkle depth), beauty
filters or portrait-mode skin smoothing, and heavy compression.

> Directional lighting is the single most common source of spurious results.
> A shadow cast across the nasolabial fold reads as a deeper fold. If the
> before shot has window light from the left and the after shot doesn't, you
> will measure the window.

---

## 3. How to organize photos

One folder per subject. Any folder name works — a study ID, a pseudonymous
code, anything you can trace back through your own records.

```
my-photos/
├── manifest.json
├── SUBJ001/
│   ├── baseline.jpg
│   ├── week02.jpg
│   └── week12.jpg
└── SUBJ002/
    ├── baseline.jpg
    └── week02.jpg
```

> **Do not name folders with medical record numbers, patient names, or
> initials, and do not encode dates of service in filenames.** Those are
> HIPAA-enumerated identifiers, and they propagate into the results CSV, which
> is easy to share by accident. Use an opaque study ID and keep the mapping to
> real identities outside this repository.

Keep your photo directory **outside the repo**, or inside it at a path the
`.gitignore` already covers (`photos/`, `Photos/`, `*_standardized/`).

---

## 4. How to tag photos: `manifest.json`

The manifest sits at the top of your photo directory and declares which image
is the baseline and which are follow-ups. Copy
[`scripts/manifest.example.json`](scripts/manifest.example.json) and edit.

```json
{
  "cohorts": [
    {
      "folder": "SUBJ001",
      "studyTitle": "Topical retinoid pilot",
      "initials": "S01",
      "locationCode": "SITE-A",
      "photos": [
        { "role": "before", "relativePath": "SUBJ001/baseline.jpg" },
        { "role": "after",  "relativePath": "SUBJ001/week02.jpg", "weeksAfter": 2 },
        { "role": "after",  "relativePath": "SUBJ001/week12.jpg", "weeksAfter": 12 }
      ]
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `folder` | yes | Must match the directory name exactly |
| `role` | yes | Exactly one `before`; one or more `after` |
| `relativePath` | yes | `<folder>/<filename>`, relative to the photo dir |
| `weeksAfter` | no | **Metadata only** — see below |
| `studyTitle` | no | Free text, carried into the results CSV |
| `initials` | no | Use a pseudonymous code, not real initials |
| `locationCode` | no | Site or clinic identifier |

**Every `after` is scored against the same `before`.** Follow-ups are not
compared to each other, and `weeksAfter` does not affect scoring in any way —
a 2-week and a 12-week photo are scored identically. It exists so you can
stratify the results yourself afterwards.

**Multiple interventions per subject**: use separate cohort entries with
distinct `folder` values. One baseline per cohort is a hard requirement.

---

## 5. Build your reference

One command runs all four stages:

```bash
scripts/build-reference.sh /path/to/my-photos
```

| Stage | What happens |
|---|---|
| 1. Preprocess | De-identify, then standardize to 512×512 |
| 2. Score | Each pair scored against rubric v1.1 |
| 3. Freeze | Cohort mean/SD captured into `scripts/reference/cohort-reference.json` |
| 4. Apply | Reference applied back to the results CSV |

**Minimum cohort size is 30 pairs.** Below that the script refuses: a reference
built on a handful of pairs produces unstable z-scores that look authoritative
and aren't. If you have fewer, you can still get every raw measurement (§7) —
you just won't get the standardized composite.

Rebuilding an existing reference prompts before overwriting and keeps a
timestamped backup, because rebuilding invalidates every score previously
reported against it.

---

## 6. Validate before you trust it

```bash
python3 scripts/validate_pipeline.py \
    --standardized-dir /path/to/my-photos_standardized \
    --out scripts/reference/validation-report.json
```

Three controls whose correct answers are known in advance:

| Control | Expected | What a failure means |
|---|---|---|
| **Repeatability** — same pair, N times | SD of 0 | Your noise floor. Effects smaller than it are not measurable. |
| **Null pair** — an image against *itself* | All deltas 0 | The model is reporting change where there is none. |
| **Order swap** — before/after reversed | Deltas negate | Position bias. Since "after" is always second, it inflates every result. |

Run this **before** the full cohort scoring run. It costs a few dollars and
five minutes, versus discovering afterwards that your reference baked in a bias
that every future score is measured against.

---

## 7. What you get

Per pair, with **no reference required**:

- **Predicted facial age** — before, after, and the difference in years
- **Seven anatomic sub-regions**, severity 0–100 before/after/delta: crow's feet,
  nasolabial folds, forehead lines, glabellar lines, perioral lines, under-eye
  hollows, jawline laxity
- **Wrinkles** and **subclinical wrinkles**, 0–100 before/after/delta
- **Perceived** skin firmness, density, facial fullness, gonial angle
- **Landmark proxies** — gonial angle, cheek fullness, jaw-width ratio
- Model self-rated confidence

Requiring a **frozen reference**:

- **Four domain z-scores** — Age, Wrinkles, Volume, Jawline
- **Composite improvement score** — mean of the four
- **Percentile** within the reference cohort

The Wrinkles domain is the mean of all seven sub-regions. If any one of them is
unavailable, the domain is `N/A` rather than a partial average — a mean over six
regions is a different measurement and is not comparable to the reference.

---

## 8. Reading the output honestly

**`N/A` means not determined.** It is never zero, and never a default. If a
value could not be established, every layer reports `N/A` and states why. Treat
that as information, not as a bug.

**The composite requires all four domains.** Three-of-four yields `N/A` with the
missing domain named.

**Scores are only comparable within matching provenance.** Every score records
its rubric version, preprocessing version, and exact model snapshot. Change any
of them and the pipeline refuses to score against the old reference rather than
silently returning a meaningless number. This is why model IDs are pinned to
dated snapshots.

**Predicted age is coarse.** In our reference cohort, values clustered heavily
on even integers with roughly a third landing on the same value. Check your own
repeatability SD before interpreting a small change as real.

**This is exploratory research tooling, not a medical device.** It is not
validated for diagnosis or treatment decisions, has no regulatory clearance,
and its outputs are model estimates of *appearance*, not measurements of tissue.

---

## 9. Handling patient data

- Keep photo directories **outside the repo**, or at an ignored path.
- Use **opaque study IDs**. No MRNs, names, initials, or dates of service in
  folder or file names — they flow into the results CSV.
- `scripts/results.csv` is gitignored **because it carries subject identifiers**.
  Keep it that way.
- **De-identification is local-only, with no remote fallback.** An earlier
  version, when local detection failed, uploaded the original identifiable
  photograph to a third party to be described and then synthesized a
  replacement. That path is removed. Detection now either succeeds locally or
  throws, so a photo that cannot be de-identified never leaves your machine.
- Facial images are HIPAA-enumerated identifiers. Masking eyes and removing
  hair is **not** a recognized Safe Harbor de-identification method.
- Confirm your own IRB or ethics approval before running this on patient
  photographs.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `improvementScore: N/A`, reason mentions no reference | No reference built yet — §5 |
| `N/A`, reason mentions preprocessing mismatch | Pair scored under different preprocessing than the reference; re-run stage 1 |
| `N/A`, reason names a model mismatch | Model changed since the reference was frozen; re-pin or rebuild |
| `Refusing to build: only N eligible pairs` | Fewer than 30 usable pairs — §5 |
| `EXCLUDE ... generative de-id fallback` | Local face detection failed; check photo quality and framing |
| `Photo standardization analysis failed` | Only in `--ai-guided` mode; check `ANTHROPIC_API_KEY` |
| `preprocessing version mismatch` from `score_pairs.py` | Re-run `standardize-cohort.ts` |

---

## Where to go next

- [`README.md`](README.md) — architecture and repository layout
- [`scripts/reference/README.md`](scripts/reference/README.md) — why the reference is frozen
- [`shared/rubric.v1.1.json`](shared/rubric.v1.1.json) — the scoring rubric itself
