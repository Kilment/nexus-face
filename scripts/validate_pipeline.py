"""
Measure whether the scoring pipeline is trustworthy on photos it has not seen.

Cohort statistics tell you nothing about reliability, because every pair in
them was scored once with no control. This script runs three controls whose
correct answers are known in advance, so a failure is unambiguous.

  1. REPEATABILITY — score the same pair N times.
     Expected: identical results. Reported: per-metric SD. This is the noise
     floor. Any real effect smaller than it is not measurable by this pipeline.

  2. NULL PAIR — score an image against ITSELF.
     Expected: every delta exactly 0. A non-zero result is pure fabrication:
     the model reported a change between an image and itself. The mean over
     null pairs is the pipeline's bias; its SD is its false-signal magnitude.

  3. ORDER SWAP — score (before, after), then (after, before).
     Expected: deltas negate exactly. Deviation is position bias — the model
     favouring whichever image it sees second, independent of content. This
     directly inflates apparent improvement, since "after" is always second.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python3 scripts/validate_pipeline.py \\
        --standardized-dir "/path/to/Photos_std" \\
        --out scripts/reference/validation-report.json

    # Optional:
    #   --pairs 10        how many distinct pairs to test (default 8)
    #   --replicates 3    repeats per pair for the repeatability check
    #   --model <id>      pinned dated snapshot
    #   --checks repeatability,null,swap
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Optional

from nexus_pipeline import (
    PREPROCESSING_VERSION,
    RUBRIC_VERSION,
    SCALAR_FIELDS,
    SUB_REGIONS,
    fmt,
    harmonize_pair,
)
from score_pairs import (
    DEFAULT_MODEL,
    Pair,
    _load_anthropic,
    enumerate_pairs,
    score_once,
)

DELTA_FIELDS = [
    "deltaPredictedFacialAge",
    "deltaWrinkles",
    "deltaSubclinicalWrinkles",
    "perceivedSkinFirmnessDelta",
    "perceivedDensityDelta",
    "perceivedFacialFullnessDelta",
    "perceivedGonialAngleDelta",
    *[f"{r}Delta" for r in SUB_REGIONS],
]

# A null pair must produce 0. Anything at or above this is reported as a
# failure rather than rounding noise.
NULL_PAIR_TOLERANCE = 0.5


def summarize(values: list[Optional[float]]) -> dict:
    present = [v for v in values if v is not None]
    if not present:
        return {"n": 0, "mean": None, "sd": None, "min": None, "max": None}
    return {
        "n": len(present),
        "mean": round(statistics.mean(present), 4),
        "sd": round(statistics.stdev(present), 4) if len(present) > 1 else None,
        "min": round(min(present), 4),
        "max": round(max(present), 4),
    }


def run_repeatability(client, model: str, pairs: list[Pair], replicates: int) -> dict:
    """Same pair, scored repeatedly. Spread = the pipeline's noise floor."""
    per_field: dict[str, list[float]] = {f: [] for f in DELTA_FIELDS}
    per_pair: list[dict] = []

    for pair in pairs:
        before_b64, after_b64 = harmonize_pair(pair.beforePath, pair.afterPath)
        runs: list[dict] = []
        for _ in range(replicates):
            try:
                metrics, _ = score_once(client, model, before_b64, after_b64)
                runs.append(metrics)
            except Exception as e:  # noqa: BLE001
                print(f"  repeatability run failed ({pair.folder}): {e}", file=sys.stderr)

        if len(runs) < 2:
            continue

        pair_sds = {}
        for field in DELTA_FIELDS:
            vals = [r[field] for r in runs if r.get(field) is not None]
            if len(vals) > 1:
                sd = statistics.stdev(vals)
                pair_sds[field] = round(sd, 4)
                per_field[field].append(sd)

        per_pair.append(
            {
                "folder": pair.folder,
                "after": pair.afterPath.name,
                "runs": len(runs),
                "sd": pair_sds,
            }
        )
        print(
            f"  {pair.folder:>12} {pair.afterPath.name:<28} "
            f"ΔAge SD={pair_sds.get('deltaPredictedFacialAge', 'n/a')}"
        )

    return {
        "replicatesPerPair": replicates,
        "pairsTested": len(per_pair),
        "meanSdByField": {f: summarize(v)["mean"] for f, v in per_field.items()},
        "perPair": per_pair,
    }


def run_null_pairs(client, model: str, pairs: list[Pair]) -> dict:
    """
    An image against itself. Every delta must be 0; whatever comes back
    instead is the pipeline inventing change where there is none.
    """
    per_field: dict[str, list[Optional[float]]] = {f: [] for f in DELTA_FIELDS}
    failures: list[dict] = []

    for pair in pairs:
        # Harmonizing an image with itself is a no-op, which is the point:
        # the model sees two byte-identical images.
        before_b64, after_b64 = harmonize_pair(pair.beforePath, pair.beforePath)
        try:
            metrics, _ = score_once(client, model, before_b64, after_b64)
        except Exception as e:  # noqa: BLE001
            print(f"  null-pair run failed ({pair.folder}): {e}", file=sys.stderr)
            continue

        nonzero = {
            f: metrics[f]
            for f in DELTA_FIELDS
            if metrics.get(f) is not None and abs(metrics[f]) >= NULL_PAIR_TOLERANCE
        }
        for field in DELTA_FIELDS:
            per_field[field].append(metrics.get(field))

        if nonzero:
            failures.append(
                {"folder": pair.folder, "image": pair.beforePath.name, "nonZeroDeltas": nonzero}
            )

        age = metrics.get("deltaPredictedFacialAge")
        flag = "  <-- FABRICATED CHANGE" if nonzero else ""
        print(f"  {pair.folder:>12} {pair.beforePath.name:<28} ΔAge={fmt(age, 2)}{flag}")

    return {
        "tolerance": NULL_PAIR_TOLERANCE,
        "pairsTested": sum(1 for v in per_field["deltaPredictedFacialAge"] if v is not None),
        "biasByField": {f: summarize(v) for f, v in per_field.items()},
        "failures": failures,
    }


def run_order_swap(client, model: str, pairs: list[Pair]) -> dict:
    """
    (before, after) then (after, before). Deltas should negate exactly.
    Residual = forward + reversed; a non-zero mean means the model favours the
    second image regardless of content, which inflates every "after".
    """
    per_field: dict[str, list[Optional[float]]] = {f: [] for f in DELTA_FIELDS}
    per_pair: list[dict] = []

    for pair in pairs:
        fwd_b, fwd_a = harmonize_pair(pair.beforePath, pair.afterPath)
        rev_b, rev_a = harmonize_pair(pair.afterPath, pair.beforePath)
        try:
            forward, _ = score_once(client, model, fwd_b, fwd_a)
            reverse, _ = score_once(client, model, rev_b, rev_a)
        except Exception as e:  # noqa: BLE001
            print(f"  order-swap run failed ({pair.folder}): {e}", file=sys.stderr)
            continue

        residuals = {}
        for field in DELTA_FIELDS:
            f_val, r_val = forward.get(field), reverse.get(field)
            if f_val is None or r_val is None:
                per_field[field].append(None)
                continue
            residual = f_val + r_val  # 0 when perfectly antisymmetric
            residuals[field] = round(residual, 4)
            per_field[field].append(residual)

        per_pair.append(
            {"folder": pair.folder, "after": pair.afterPath.name, "residuals": residuals}
        )
        print(
            f"  {pair.folder:>12} {pair.afterPath.name:<28} "
            f"ΔAge fwd={fmt(forward.get('deltaPredictedFacialAge'), 1)} "
            f"rev={fmt(reverse.get('deltaPredictedFacialAge'), 1)} "
            f"residual={residuals.get('deltaPredictedFacialAge', 'n/a')}"
        )

    return {
        "pairsTested": len(per_pair),
        "residualByField": {f: summarize(v) for f, v in per_field.items()},
        "perPair": per_pair,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--standardized-dir", required=True)
    ap.add_argument("--out", required=True, help="Validation report JSON output path")
    ap.add_argument("--pairs", type=int, default=8)
    ap.add_argument("--replicates", type=int, default=3)
    ap.add_argument("--model", default=os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL))
    ap.add_argument(
        "--checks",
        default="repeatability,null,swap",
        help="Comma-separated subset of: repeatability, null, swap",
    )
    args = ap.parse_args()

    checks = {c.strip() for c in args.checks.split(",") if c.strip()}
    standardized_dir = Path(args.standardized_dir).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()

    all_pairs, _, _ = enumerate_pairs(standardized_dir)
    # Deterministic subset so reruns are comparable.
    pairs = sorted(all_pairs, key=lambda p: (p.folder, p.afterPath.name))[: args.pairs]
    if not pairs:
        sys.stderr.write("No pairs available to validate.\n")
        return 1

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.stderr.write("ANTHROPIC_API_KEY env var not set\n")
        return 1

    client = _load_anthropic().Anthropic()

    print(f"Model:         {args.model}")
    print(f"Rubric:        {RUBRIC_VERSION}")
    print(f"Preprocessing: {PREPROCESSING_VERSION}")
    print(f"Pairs:         {len(pairs)}\n")

    report: dict = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": args.model,
        "rubricVersion": RUBRIC_VERSION,
        "preprocessingVersion": PREPROCESSING_VERSION,
        "pairsTested": len(pairs),
    }

    if "repeatability" in checks:
        print(f"[1] Repeatability — {args.replicates} runs per pair, expect SD 0")
        report["repeatability"] = run_repeatability(client, args.model, pairs, args.replicates)
        print()

    if "null" in checks:
        print("[2] Null pairs — image vs itself, expect all deltas 0")
        report["nullPairs"] = run_null_pairs(client, args.model, pairs)
        print()

    if "swap" in checks:
        print("[3] Order swap — expect forward and reverse deltas to negate")
        report["orderSwap"] = run_order_swap(client, args.model, pairs)
        print()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    # ---- Verdict -----------------------------------------------------------
    print("=" * 68)
    problems: list[str] = []

    if "repeatability" in checks:
        age_sd = report["repeatability"]["meanSdByField"].get("deltaPredictedFacialAge")
        if age_sd is not None:
            print(f"Noise floor (ΔAge SD across repeats):     {age_sd:+.3f} years")
            if age_sd > 1.0:
                problems.append(
                    f"ΔAge repeat SD is {age_sd:.2f} years — effects below that are unmeasurable."
                )

    if "null" in checks:
        bias = report["nullPairs"]["biasByField"]["deltaPredictedFacialAge"]
        n_fail = len(report["nullPairs"]["failures"])
        if bias["mean"] is not None:
            print(f"Null-pair ΔAge bias (must be 0):          {bias['mean']:+.3f} years")
        print(f"Null pairs reporting fabricated change:   {n_fail}/{len(pairs)}")
        if n_fail:
            problems.append(
                f"{n_fail} null pair(s) reported change between an image and itself."
            )

    if "swap" in checks:
        residual = report["orderSwap"]["residualByField"]["deltaPredictedFacialAge"]
        if residual["mean"] is not None:
            print(f"Order-swap ΔAge residual (must be 0):     {residual['mean']:+.3f} years")
            if abs(residual["mean"]) > 1.0:
                problems.append(
                    f"Order-swap residual is {residual['mean']:+.2f} years — the model favours "
                    "the second image regardless of content, which inflates every 'after'."
                )

    print("=" * 68)
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print(f"  - {p}")
    else:
        print("\nAll controls within tolerance.")
    print(f"\nReport: {out_path}")

    return 2 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
