"""
Freeze a cohort reference: the fixed per-domain mean/sd and composite
distribution that every future pair is standardized against.

Why freeze it. Standardizing against the live cohort has two fatal properties
for a pipeline meant to handle new photos:

  * a new pair cannot be scored on its own — it needs the whole cohort present;
  * adding a pair retroactively changes every previously reported score.

Freezing makes a score a property of the pair plus a named reference version,
so it is reproducible and stable.

The reference records the rubric, preprocessing and model it was built under.
Scoring refuses to proceed when a pair's provenance does not match, because a
z-score against a differently-produced distribution is meaningless.

Usage:
    python3 scripts/build_cohort_reference.py \\
        --csv scripts/results.csv \\
        --out scripts/reference/cohort-reference.json

    # Optional:
    #   --version v2                     label for this reference
    #   --include-generative-deid        include synthesized-pixel pairs (off by default)
    #   --min-n 30                       refuse to build below this sample size
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Optional

from nexus_pipeline import (
    DOMAIN_KEYS,
    PREPROCESSING_VERSION,
    RUBRIC_VERSION,
    compute_raw_domains,
    parse_csv_value,
)


def load_rows(csv_path: Path) -> list[dict]:
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def to_numeric_row(row: dict) -> dict:
    """Parse every scored column, mapping N/A and blanks to None."""
    out: dict = {}
    for key, raw in row.items():
        if key in ("notes", "error", "warnings", "pipelineNotes"):
            continue
        out[key] = parse_csv_value(raw)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True, help="Scored results CSV from score_pairs.py")
    ap.add_argument("--out", required=True, help="Reference JSON output path")
    ap.add_argument("--version", default=None, help="Reference version label")
    ap.add_argument(
        "--include-generative-deid",
        action="store_true",
        help="Include pairs whose images were generatively de-identified",
    )
    ap.add_argument("--min-n", type=int, default=30, help="Refuse to build below this many pairs")
    args = ap.parse_args()

    csv_path = Path(args.csv).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    rows = load_rows(csv_path)
    if not rows:
        sys.stderr.write("No rows in CSV.\n")
        return 1

    # ---- Filter to rows that are legitimately part of a reference ----------
    eligible: list[dict] = []
    excluded: dict[str, int] = {}

    def exclude(reason: str) -> None:
        excluded[reason] = excluded.get(reason, 0) + 1

    models: set[str] = set()

    for row in rows:
        if row.get("error"):
            exclude("scoring error")
            continue
        if row.get("rubricVersion") != RUBRIC_VERSION:
            exclude(f"rubric {row.get('rubricVersion')!r} != {RUBRIC_VERSION!r}")
            continue
        if row.get("preprocessingVersion") != PREPROCESSING_VERSION:
            exclude(f"preprocessing {row.get('preprocessingVersion')!r} != {PREPROCESSING_VERSION!r}")
            continue
        if row.get("generativeDeIdUsed") == "true" and not args.include_generative_deid:
            exclude("generative de-identification (synthesized pixels)")
            continue
        models.add(row.get("model", ""))
        eligible.append(row)

    if excluded:
        print("Excluded rows:")
        for reason, count in sorted(excluded.items(), key=lambda kv: -kv[1]):
            print(f"  {count:>4}  {reason}")

    if len(models) > 1:
        sys.stderr.write(
            f"\nRefusing to build: rows were scored by more than one model {sorted(models)}.\n"
            "A single reference distribution cannot mix models — their scales differ.\n"
            "Re-score the cohort under one pinned model.\n"
        )
        return 1

    if len(eligible) < args.min_n:
        sys.stderr.write(
            f"\nRefusing to build: only {len(eligible)} eligible pairs, below --min-n {args.min_n}.\n"
            "A reference built on too few pairs produces unstable z-scores.\n"
        )
        return 1

    # ---- Domain statistics -------------------------------------------------
    numeric_rows = [to_numeric_row(r) for r in eligible]
    domain_values: dict[str, list[float]] = {k: [] for k in DOMAIN_KEYS}
    complete_rows: list[dict[str, float]] = []

    for nrow in numeric_rows:
        domains = compute_raw_domains(nrow)
        if any(v is None for v in domains.values()):
            exclude("incomplete domains (a required input was N/A)")
            continue
        for key in DOMAIN_KEYS:
            domain_values[key].append(domains[key])  # type: ignore[arg-type]
        complete_rows.append(domains)  # type: ignore[arg-type]

    if len(complete_rows) < args.min_n:
        sys.stderr.write(
            f"\nRefusing to build: only {len(complete_rows)} pairs have all four domains "
            f"computable, below --min-n {args.min_n}.\n"
        )
        return 1

    domains_out: dict[str, dict] = {}
    for key in DOMAIN_KEYS:
        values = domain_values[key]
        sd = statistics.stdev(values)
        if sd <= 0:
            sys.stderr.write(
                f"\nRefusing to build: domain {key!r} has zero variance across "
                f"{len(values)} pairs, so it cannot be standardized.\n"
            )
            return 1
        domains_out[key] = {
            "mean": round(statistics.mean(values), 6),
            "sd": round(sd, 6),
            "n": len(values),
        }

    # ---- Composite distribution for percentile lookup ----------------------
    composites: list[float] = []
    for domains in complete_rows:
        zs = [
            (domains[k] - domains_out[k]["mean"]) / domains_out[k]["sd"]
            for k in DOMAIN_KEYS
        ]
        composites.append(statistics.mean(zs))
    composites.sort()

    reference = {
        "referenceVersion": args.version or f"cohort-{time.strftime('%Y%m%d')}",
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rubricVersion": RUBRIC_VERSION,
        "preprocessingVersion": PREPROCESSING_VERSION,
        "modelId": next(iter(models)) if models else "",
        "sampleSize": len(complete_rows),
        "domains": domains_out,
        "compositeDistribution": [round(c, 6) for c in composites],
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(reference, indent=2) + "\n", encoding="utf-8")

    print(f"\nWrote {out_path}")
    print(f"  referenceVersion  {reference['referenceVersion']}")
    print(f"  model             {reference['modelId']}")
    print(f"  sampleSize        {reference['sampleSize']}")
    for key in DOMAIN_KEYS:
        d = domains_out[key]
        print(f"  {key:<9} mean={d['mean']:+.4f}  sd={d['sd']:.4f}  n={d['n']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
