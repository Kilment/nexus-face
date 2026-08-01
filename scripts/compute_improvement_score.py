"""
Append standardized improvement scores to a scored results CSV.

Algorithm (identical to shared/improvement-score.ts — do not fork one without
the other):

  1. Build four clinical domains, positive = improvement everywhere:
       Age      = -deltaPredictedFacialAge
       Wrinkles = mean of the 7 SUB-REGION deltas, sign-flipped
                  (crowsFeet, nasolabialFolds, foreheadLines, glabellarLines,
                   perioralLines, underEyeHollows, jawlineLaxity)
       Volume   = mean of perceivedSkinFirmnessDelta,
                          perceivedDensityDelta,
                          perceivedFacialFullnessDelta
       Jawline  = mean of -jawlineLaxityDelta and perceivedGonialAngleDelta
  2. Standardize each domain against the FROZEN reference (not this CSV).
  3. Composite = mean of the four domain z-scores, only when all four exist.
  4. Percentile = position within the frozen reference's composite distribution.

Two rules this script enforces:

  * A domain requires ALL of its inputs. A partial mean is a different
    estimator and is not comparable to the reference, so it yields N/A.
  * A missing value is N/A. It is never 0, and a pair missing one domain does
    not receive a composite built from the other three.

Usage:
    python3 scripts/compute_improvement_score.py \\
        --csv scripts/results.csv \\
        --reference scripts/reference/cohort-reference.json
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from pathlib import Path
from typing import Optional

from nexus_pipeline import (
    DOMAIN_KEYS,
    NOT_AVAILABLE,
    PREPROCESSING_VERSION,
    RUBRIC_VERSION,
    compute_raw_domains,
    fmt,
    parse_csv_value,
)

NEW_COLUMNS = [
    "ageImprovementZ",
    "wrinklesImprovementZ",
    "volumeImprovementZ",
    "jawlineImprovementZ",
    "improvementScore",
    "improvementPercentile",
    "improvementUnavailableReason",
    "referenceVersion",
]

DOMAIN_COLUMN = {
    "age": "ageImprovementZ",
    "wrinkles": "wrinklesImprovementZ",
    "volume": "volumeImprovementZ",
    "jawline": "jawlineImprovementZ",
}

DOMAIN_MISSING_REASON = {
    "age": "deltaPredictedFacialAge is N/A",
    "wrinkles": "one or more of the 7 sub-region deltas is N/A",
    "volume": "one or more perceived firmness/density/fullness deltas is N/A",
    "jawline": "jawlineLaxityDelta or perceivedGonialAngleDelta is N/A",
}


def percentile_against(sorted_ascending: list[float], value: float) -> float:
    """Midpoint-of-ties position within the reference distribution, 0..100."""
    below = sum(1 for v in sorted_ascending if v < value)
    equal = sum(1 for v in sorted_ascending if v == value)
    return (below + equal / 2) / len(sorted_ascending) * 100


def to_numeric_row(row: dict) -> dict:
    out: dict = {}
    for key, raw in row.items():
        if key in ("notes", "error", "warnings", "pipelineNotes"):
            continue
        out[key] = parse_csv_value(raw)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True, help="Results CSV (updated in place)")
    ap.add_argument("--reference", required=True, help="Frozen cohort reference JSON")
    args = ap.parse_args()

    csv_path = Path(args.csv).expanduser().resolve()
    ref_path = Path(args.reference).expanduser().resolve()

    if not ref_path.is_file():
        sys.stderr.write(
            f"No cohort reference at {ref_path}.\n"
            "Build one first: python3 scripts/build_cohort_reference.py\n"
        )
        return 1

    reference = json.loads(ref_path.read_text(encoding="utf-8"))
    ref_domains = reference["domains"]
    ref_distribution = sorted(reference["compositeDistribution"])

    rows = list(csv.DictReader(csv_path.open("r", newline="", encoding="utf-8")))
    if not rows:
        print("No rows found.")
        return 1

    fieldnames = [c for c in rows[0].keys() if c not in NEW_COLUMNS]
    fieldnames.extend(NEW_COLUMNS)

    scored = 0
    unscoreable: dict[str, int] = {}

    for row in rows:
        numeric = to_numeric_row(row)

        # Provenance gate: a z-score only means something against a reference
        # produced the same way.
        mismatch: Optional[str] = None
        if row.get("error"):
            mismatch = "row recorded a scoring error"
        elif row.get("rubricVersion") not in (RUBRIC_VERSION, None, ""):
            if row.get("rubricVersion") != reference["rubricVersion"]:
                mismatch = (
                    f"rubric {row.get('rubricVersion')} != reference {reference['rubricVersion']}"
                )
        if mismatch is None and row.get("preprocessingVersion"):
            if row["preprocessingVersion"] != reference["preprocessingVersion"]:
                mismatch = (
                    f"preprocessing {row['preprocessingVersion']} != "
                    f"reference {reference['preprocessingVersion']}"
                )
        if mismatch is None and row.get("model") and row["model"] != reference["modelId"]:
            mismatch = f"model {row['model']} != reference {reference['modelId']}"

        if mismatch:
            for col in DOMAIN_COLUMN.values():
                row[col] = NOT_AVAILABLE
            row["improvementScore"] = NOT_AVAILABLE
            row["improvementPercentile"] = NOT_AVAILABLE
            row["improvementUnavailableReason"] = mismatch
            row["referenceVersion"] = reference["referenceVersion"]
            unscoreable[mismatch] = unscoreable.get(mismatch, 0) + 1
            continue

        raw_domains = compute_raw_domains(numeric)
        zs: dict[str, Optional[float]] = {}
        for key in DOMAIN_KEYS:
            raw = raw_domains[key]
            if raw is None:
                zs[key] = None
            else:
                stats = ref_domains[key]
                zs[key] = (raw - stats["mean"]) / stats["sd"]
            row[DOMAIN_COLUMN[key]] = fmt(zs[key])

        missing = [k for k in DOMAIN_KEYS if zs[k] is None]
        if missing:
            reason = "; ".join(DOMAIN_MISSING_REASON[k] for k in missing)
            row["improvementScore"] = NOT_AVAILABLE
            row["improvementPercentile"] = NOT_AVAILABLE
            row["improvementUnavailableReason"] = f"missing domain(s): {reason}"
            unscoreable[f"missing domains: {','.join(missing)}"] = (
                unscoreable.get(f"missing domains: {','.join(missing)}", 0) + 1
            )
        else:
            composite = statistics.mean([zs[k] for k in DOMAIN_KEYS])  # type: ignore[misc]
            row["improvementScore"] = fmt(composite)
            row["improvementPercentile"] = fmt(
                percentile_against(ref_distribution, composite), 2
            )
            row["improvementUnavailableReason"] = ""
            scored += 1

        row["referenceVersion"] = reference["referenceVersion"]

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"Updated {csv_path} over {len(rows)} rows.")
    print(f"Reference: {reference['referenceVersion']} (n={reference['sampleSize']})")
    print(f"Scored: {scored}    Unscoreable: {len(rows) - scored}")
    for reason, count in sorted(unscoreable.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4}  {reason}")

    values = [
        parse_csv_value(r["improvementScore"])
        for r in rows
        if parse_csv_value(r.get("improvementScore")) is not None
    ]
    if len(values) > 1:
        print(
            "\nimprovementScore  "
            f"min={min(values):+.3f}  max={max(values):+.3f}  "
            f"mean={statistics.mean(values):+.3f}  "
            f"median={statistics.median(values):+.3f}  "
            f"sd={statistics.stdev(values):.3f}"
        )

    scored_rows = [
        (parse_csv_value(r["improvementScore"]), r)
        for r in rows
        if parse_csv_value(r.get("improvementScore")) is not None
    ]
    scored_rows.sort(key=lambda cr: cr[0])  # type: ignore[arg-type,return-value]

    def show(label: str, subset) -> None:
        print(f"\n{label}:")
        for c, r in subset:
            print(
                f"  score={c:+.2f}  pct={r['improvementPercentile']:>6}  "
                f"folder={r['folder']:>10}  weeks={r['weeksAfter'] or NOT_AVAILABLE:>3}  "
                f"after={Path(r['afterPath']).name}"
            )

    if scored_rows:
        show("Bottom 5 (worst)", scored_rows[:5])
        show("Top 5 (best)", scored_rows[-5:][::-1])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
