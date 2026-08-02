"""
Score every BEFORE/AFTER pair from a standardized cohort against the shared
rubric, and append results to a CSV.

This script no longer defines its own rubric or its own preprocessing. It reads
shared/rubric.v1.1.json (the same file server/vision-rubric.ts reads) and
consumes images already run through canonical preprocessing, so a batch score
and an in-app score of the same pair are comparable.

Pipeline:
    1. npx tsx scripts/standardize-cohort.ts \\
           --photos-dir "/path/to/Photos" --out-dir "/path/to/Photos_std"
    2. export ANTHROPIC_API_KEY=sk-ant-...
       python3 scripts/score_pairs.py \\
           --standardized-dir "/path/to/Photos_std" --out scripts/results.csv
    3. python3 scripts/build_cohort_reference.py \\
           --csv scripts/results.csv --out scripts/reference/cohort-reference.json
    4. python3 scripts/compute_improvement_score.py \\
           --csv scripts/results.csv --reference scripts/reference/cohort-reference.json

Optional flags:
    --model <id>        pinned dated snapshot (default below)
    --concurrency 4     parallel API calls
    --limit 1           smoke-test on a single pair
    --replicates 3      score each pair N times and record the spread
    --dry-run           resolve files only, no API calls

Resumable: pairs already present in the CSV (keyed on beforePath + afterPath)
are skipped unless they recorded an error.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from nexus_pipeline import (
    NOT_AVAILABLE,
    PREPROCESSING_VERSION,
    SUPPORTED_PREPROCESSING_VERSIONS,
    RUBRIC_PROMPT,
    RUBRIC_VERSION,
    SCALAR_FIELDS,
    SUB_REGIONS,
    USER_TURN_TEXT,
    find_range_violations,
    find_self_consistency_violations,
    fmt,
    harmonize_pair,
    normalize_metrics,
)

SCRIPT_VERSION = "score_pairs.py v2.0"

# Pinned dated snapshot. A floating alias silently re-points to a new model,
# which shifts every score and invalidates the frozen cohort reference — so the
# newer undated IDs (claude-opus-5, claude-sonnet-5, claude-opus-4-8, ...) are
# deliberately NOT used here despite being more capable. This is the most
# capable snapshot that carries a date.
DEFAULT_MODEL = "claude-opus-4-5-20251101"

FLOATING_ALIAS = re.compile(r"^(claude-[a-z0-9.]+-\d(-\d)?|claude-\d[a-z-]*|.*-latest)$")

METRIC_FIELDS = [*SCALAR_FIELDS, "confidence", "notes"]

SUBREGION_FIELDS: list[str] = []
for _r in SUB_REGIONS:
    SUBREGION_FIELDS.extend([f"{_r}Before", f"{_r}After", f"{_r}Delta"])

CSV_HEADER = [
    "studyTitle",
    "folder",
    "initials",
    "locationCode",
    "interventionLabel",
    "beforePath",
    "afterPath",
    "weeksAfter",
    *METRIC_FIELDS,
    *SUBREGION_FIELDS,
    # Provenance — a score is only comparable within matching provenance.
    "model",
    "rubricVersion",
    "preprocessingVersion",
    "generativeDeIdUsed",
    "replicates",
    "replicateAgeSd",
    "orderBalanced",
    "positionBiasAge",
    "scoredAt",
    "pipelineNotes",
    "warnings",
    "error",
]


def _load_anthropic():
    try:
        import anthropic  # type: ignore

        return anthropic
    except ImportError:
        sys.stderr.write(
            "anthropic package not installed. Run: pip install --break-system-packages anthropic\n"
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Pair model — built from the preprocessing manifest, not from raw folders.
# ---------------------------------------------------------------------------
@dataclass
class Pair:
    studyTitle: str
    folder: str
    initials: str
    locationCode: str
    beforePath: Path
    afterPath: Path
    weeksAfter: Optional[int]
    generativeDeIdUsed: bool


def enumerate_pairs(standardized_dir: Path) -> tuple[list[Pair], list[dict], dict]:
    manifest_path = standardized_dir / "preprocessing-manifest.json"
    if not manifest_path.is_file():
        sys.stderr.write(
            f"No preprocessing manifest at {manifest_path}.\n"
            "Run scripts/standardize-cohort.ts first — scoring raw photos would use "
            "different preprocessing than the app and produce non-comparable results.\n"
        )
        sys.exit(1)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    manifest_preprocessing = manifest.get("preprocessingVersion")
    if manifest_preprocessing not in SUPPORTED_PREPROCESSING_VERSIONS:
        sys.stderr.write(
            f"Unknown preprocessing version {manifest_preprocessing!r}. Supported: "
            f"{sorted(SUPPORTED_PREPROCESSING_VERSIONS)}. Re-run standardize-cohort.ts.\n"
        )
        sys.exit(1)

    by_folder: dict[str, list[dict]] = {}
    for record in manifest["records"]:
        by_folder.setdefault(record["folder"], []).append(record)

    pairs: list[Pair] = []
    skipped: list[dict] = list(manifest.get("skipped", []))

    for folder, records in by_folder.items():
        before = next((r for r in records if r["role"] == "before"), None)
        afters = [r for r in records if r["role"] == "after"]

        if before is None:
            skipped.append({"folder": folder, "reason": "no_before_photo"})
            continue
        if not afters:
            skipped.append({"folder": folder, "reason": "no_after_photo"})
            continue

        for after in afters:
            pairs.append(
                Pair(
                    studyTitle=before.get("studyTitle", ""),
                    folder=folder,
                    initials=before.get("initials", ""),
                    locationCode=before.get("locationCode", ""),
                    beforePath=Path(before["outputPath"]),
                    afterPath=Path(after["outputPath"]),
                    weeksAfter=after.get("weeksAfter"),
                    generativeDeIdUsed=bool(
                        before.get("generativeDeIdUsed") or after.get("generativeDeIdUsed")
                    ),
                )
            )

    return pairs, skipped, manifest


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def extract_json(text: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError(f"No JSON object found in response: {text[:300]!r}")
    return json.loads(m.group(0))


def score_once(client, model: str, before_b64: str, after_b64: str) -> tuple[dict, list[str]]:
    """One scored attempt. Returns (metrics, warnings); raises on invalid output."""
    resp = client.messages.create(
        model=model,
        max_tokens=1500,
        temperature=0,
        system=RUBRIC_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": USER_TURN_TEXT},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": before_b64,
                        },
                    },
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": after_b64,
                        },
                    },
                ],
            }
        ],
    )

    raw_text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    metrics = normalize_metrics(extract_json(raw_text))

    # Out-of-scale values mean the rubric was ignored. Retry rather than clamp:
    # clamping would manufacture a plausible number from an invalid response.
    range_problems = find_range_violations(metrics)
    if range_problems:
        raise ValueError(f"Range violations: {'; '.join(range_problems)}")

    return metrics, find_self_consistency_violations(metrics)


# Fields reported as a plain delta (no before/after counterpart).
_PURE_DELTA_FIELDS = [
    "deltaPredictedFacialAge",
    "deltaWrinkles",
    "deltaSubclinicalWrinkles",
    "perceivedSkinFirmnessDelta",
    "perceivedDensityDelta",
    "perceivedFacialFullnessDelta",
    "perceivedGonialAngleDelta",
]

# (before, after) pairs whose meaning swaps when the images are swapped.
_BEFORE_AFTER_FIELDS = [
    ("predictedFacialAgeBefore", "predictedFacialAgeAfter"),
    ("wrinklesBefore", "wrinklesAfter"),
    ("subclinicalWrinklesBefore", "subclinicalWrinklesAfter"),
]


def _mid(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None:
        return None
    return (a + b) / 2


def _antisymmetric(fwd: Optional[float], rev: Optional[float]) -> Optional[float]:
    """(forward - reverse) / 2 — cancels any constant position bias."""
    if fwd is None or rev is None:
        return None
    return (fwd - rev) / 2


def combine_order_balanced(fwd: dict, rev: dict) -> dict:
    """
    Merge a forward (before, after) and a reverse (after, before) scoring.

    Validation showed the model systematically rates whichever image it sees
    SECOND as improved, across every rubric field. Because "after" is always
    second, that bias inflates every result in the improvement direction.

    Antisymmetrizing removes it exactly: with a true effect D and a constant
    position bias B, forward observes D - B and reverse observes -D - B, so
    (forward - reverse) / 2 == D. The discarded half, (forward + reverse) / 2,
    estimates B and is kept as a diagnostic.
    """
    out: dict = {}

    for key in _PURE_DELTA_FIELDS:
        out[key] = _antisymmetric(fwd.get(key), rev.get(key))

    # Reverse's "before" describes the after-image, and vice versa.
    for before_key, after_key in _BEFORE_AFTER_FIELDS:
        out[before_key] = _mid(fwd.get(before_key), rev.get(after_key))
        out[after_key] = _mid(fwd.get(after_key), rev.get(before_key))

    for region in SUB_REGIONS:
        out[f"{region}Delta"] = _antisymmetric(
            fwd.get(f"{region}Delta"), rev.get(f"{region}Delta")
        )
        out[f"{region}Before"] = _mid(fwd.get(f"{region}Before"), rev.get(f"{region}After"))
        out[f"{region}After"] = _mid(fwd.get(f"{region}After"), rev.get(f"{region}Before"))

    out["confidence"] = _mid(fwd.get("confidence"), rev.get("confidence"))
    out["notes"] = fwd.get("notes", "")

    f_age, r_age = fwd.get("deltaPredictedFacialAge"), rev.get("deltaPredictedFacialAge")
    out["_positionBiasAge"] = None if f_age is None or r_age is None else (f_age + r_age) / 2
    return out


def score_pair(
    client,
    model: str,
    pair: Pair,
    replicates: int,
    max_retries: int = 4,
    order_balanced: bool = True,
) -> tuple[dict, list[str]]:
    """
    Score a pair, optionally several times. With replicates > 1 the per-field
    median is reported and the age spread is recorded, so run-to-run
    variability is visible instead of hidden behind a single sample.
    """
    before_b64, after_b64 = harmonize_pair(pair.beforePath, pair.afterPath)

    runs: list[dict] = []
    warnings: list[str] = []
    last_err: Optional[Exception] = None

    for _ in range(replicates):
        for attempt in range(max_retries):
            try:
                metrics, consistency = score_once(client, model, before_b64, after_b64)
                if order_balanced:
                    # Harmonization targets the pair mean, so swapping the
                    # arguments yields the same pixels in the other order.
                    reverse, rev_consistency = score_once(
                        client, model, after_b64, before_b64
                    )
                    consistency = consistency + rev_consistency
                    metrics = combine_order_balanced(metrics, reverse)
                if consistency:
                    if attempt < max_retries - 1:
                        raise ValueError(f"Self-inconsistent: {'; '.join(consistency)}")
                    warnings.append(
                        f"self-consistency violations persisted: {'; '.join(consistency)}"
                    )
                runs.append(metrics)
                break
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(min(30, 2**attempt))
        else:
            raise RuntimeError(f"score_pair failed after {max_retries} attempts: {last_err}")

    if len(runs) == 1:
        return runs[0], warnings

    # Median across replicates, field by field, skipping N/A values.
    merged: dict = {}
    numeric_keys = [k for k in (*SCALAR_FIELDS, "confidence", *SUBREGION_FIELDS)]
    for key in numeric_keys:
        vals = [r[key] for r in runs if r.get(key) is not None]
        merged[key] = statistics.median(vals) if vals else None
    merged["notes"] = runs[0].get("notes", "")

    ages = [r["deltaPredictedFacialAge"] for r in runs if r.get("deltaPredictedFacialAge") is not None]
    merged["_replicateAgeSd"] = statistics.stdev(ages) if len(ages) > 1 else None

    return merged, warnings


# ---------------------------------------------------------------------------
# CSV I/O — resumable
# ---------------------------------------------------------------------------
def load_done_keys(csv_path: Path) -> set[tuple[str, str]]:
    if not csv_path.exists():
        return set()
    done: set[tuple[str, str]] = set()
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("error"):
                continue  # let prior failures be retried
            key = (row.get("beforePath", ""), row.get("afterPath", ""))
            if key != ("", ""):
                done.add(key)
    return done


def append_row(csv_path: Path, row: dict, lock: threading.Lock) -> None:
    with lock:
        needs_header = (not csv_path.exists()) or csv_path.stat().st_size == 0
        with csv_path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_HEADER, extrasaction="ignore")
            if needs_header:
                writer.writeheader()
            writer.writerow(row)


def pair_to_row(
    pair: Pair,
    metrics: Optional[dict],
    model: str,
    replicates: int,
    warnings: list[str],
    order_balanced: bool,
    error: str = "",
) -> dict:
    row = {
        "studyTitle": pair.studyTitle,
        "folder": pair.folder,
        "initials": pair.initials,
        "locationCode": pair.locationCode,
        "interventionLabel": "",  # joined post-hoc from the intervention sidecar
        "beforePath": str(pair.beforePath),
        "afterPath": str(pair.afterPath),
        "weeksAfter": NOT_AVAILABLE if pair.weeksAfter is None else pair.weeksAfter,
        "model": model,
        "rubricVersion": RUBRIC_VERSION,
        "preprocessingVersion": PREPROCESSING_VERSION,
        "generativeDeIdUsed": "true" if pair.generativeDeIdUsed else "false",
        "replicates": replicates,
        "replicateAgeSd": fmt(metrics.get("_replicateAgeSd")) if metrics else NOT_AVAILABLE,
        "orderBalanced": "true" if order_balanced else "false",
        "positionBiasAge": fmt(metrics.get("_positionBiasAge")) if metrics else NOT_AVAILABLE,
        "scoredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pipelineNotes": f"rubric={RUBRIC_VERSION}; {SCRIPT_VERSION}; model={model}",
        "warnings": "; ".join(warnings),
        "error": error,
    }

    for key in (*SCALAR_FIELDS, "confidence", *SUBREGION_FIELDS):
        row[key] = NOT_AVAILABLE if not metrics else fmt(metrics.get(key))
    row["notes"] = "" if not metrics else str(metrics.get("notes", ""))

    return row


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--standardized-dir",
        required=True,
        help="Output dir of scripts/standardize-cohort.ts (contains preprocessing-manifest.json)",
    )
    parser.add_argument("--out", required=True, help="CSV output path")
    parser.add_argument("--model", default=os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL))
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--limit", type=int, default=None, help="Score at most N pairs")
    parser.add_argument(
        "--replicates",
        type=int,
        default=1,
        help="Score each pair N times; reports per-field median and the age SD",
    )
    parser.add_argument(
        "--no-order-balanced",
        action="store_true",
        help="Disable counterbalancing. Validation showed the model rates whichever "
             "image it sees second as improved, across every field; leaving this on "
             "cancels that bias at the cost of a second call per pair.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Resolve files only; no API calls")
    args = parser.parse_args()
    order_balanced = not args.no_order_balanced

    if FLOATING_ALIAS.match(args.model):
        print(
            f"WARNING: --model {args.model!r} looks like a floating alias. Scores will drift "
            f"when it re-points. Pin a dated snapshot (e.g. {DEFAULT_MODEL!r}) and rebuild "
            "the cohort reference.",
            file=sys.stderr,
        )

    standardized_dir = Path(args.standardized_dir).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    pairs, skipped, manifest = enumerate_pairs(standardized_dir)

    print(f"Standardized dir: {standardized_dir}")
    print(f"Preprocessing:    {manifest['preprocessingVersion']}")
    print(f"Rubric:           {RUBRIC_VERSION}")
    print(f"Model:            {args.model}")
    print(f"Order-balanced:   {order_balanced}"
          f"{'' if order_balanced else '  (position bias NOT corrected)'}")
    print(f"Resolved pairs:   {len(pairs)}")
    print(f"Skipped:          {len(skipped)}")
    for s in skipped:
        print(f"  SKIP {s}")

    generative = [p for p in pairs if p.generativeDeIdUsed]
    if generative:
        print(
            f"\nWARNING: {len(generative)} pair(s) include a generatively de-identified image. "
            "Their scores describe synthesized pixels, not the patient, and should be excluded "
            "from the cohort reference."
        )

    if args.limit is not None:
        pairs = pairs[: args.limit]
        print(f"--limit applied: scoring {len(pairs)} pairs")

    done_keys = load_done_keys(out_path)
    todo = [p for p in pairs if (str(p.beforePath), str(p.afterPath)) not in done_keys]
    print(f"Already scored:   {len(pairs) - len(todo)}")
    print(f"To score now:     {len(todo)}")

    if args.dry_run:
        print("Dry run — exiting before API calls.")
        return 0

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.stderr.write("ANTHROPIC_API_KEY env var not set\n")
        return 1

    anthropic = _load_anthropic()
    client = anthropic.Anthropic()

    write_lock = threading.Lock()
    success = 0
    failed = 0

    def work(pair: Pair):
        try:
            metrics, warnings = score_pair(
                client, args.model, pair, args.replicates, order_balanced=order_balanced
            )
            return pair, metrics, warnings, ""
        except Exception as e:  # noqa: BLE001
            return pair, None, [], str(e)

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as ex:
        futures = [ex.submit(work, p) for p in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            pair, metrics, warnings, err = fut.result()
            append_row(
                out_path,
                pair_to_row(
                    pair, metrics, args.model, args.replicates, warnings,
                    order_balanced, error=err,
                ),
                write_lock,
            )
            if err:
                failed += 1
                print(f"[{i}/{len(todo)}] FAIL {pair.folder} {pair.afterPath.name}: {err}")
            else:
                success += 1
                warn = f"  ! {'; '.join(warnings)}" if warnings else ""
                print(
                    f"[{i}/{len(todo)}] OK   {pair.folder} {pair.afterPath.name} "
                    f"ΔAge={fmt(metrics.get('deltaPredictedFacialAge'), 1)} "
                    f"ΔWrinkles={fmt(metrics.get('deltaWrinkles'), 1)}{warn}"
                )

    print(f"\nDone. success={success} failed={failed} csv={out_path}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
