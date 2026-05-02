"""
Compute a standardized per-pair improvement score from the rubric output in
results.csv and append it back to the same file.

Algorithm:
  1. Polarity-flip every severity metric so positive = improvement everywhere.
  2. Aggregate into four clinical domains:
       Age      = -deltaPredictedFacialAge
       Wrinkles = mean of the 7 sub-region deltas, sign-flipped
                  (crowsFeet, nasolabialFolds, foreheadLines, glabellarLines,
                   perioralLines, underEyeHollows, jawlineLaxity)
       Volume   = mean of perceivedSkinFirmnessDelta,
                          perceivedDensityDelta,
                          perceivedFacialFullnessDelta
       Jawline  = mean of -jawlineLaxityDelta and perceivedGonialAngleDelta
  3. Cohort-standardize each domain via z-score (sample std, ddof=1).
  4. Composite improvementScore = unweighted mean of the four domain z-scores.
  5. Percentile rank (0..100) across the cohort.

Output: appends six columns to results.csv:
  ageImprovementZ, wrinklesImprovementZ, volumeImprovementZ, jawlineImprovementZ,
  improvementScore, improvementPercentile

Usage:
    python3 scripts/compute_improvement_score.py --csv scripts/results.csv
"""

from __future__ import annotations

import argparse
import csv
import statistics
from pathlib import Path
from typing import Optional


SUB_REGIONS = [
    "crowsFeet",
    "nasolabialFolds",
    "foreheadLines",
    "glabellarLines",
    "perioralLines",
    "underEyeHollows",
    "jawlineLaxity",
]

NEW_COLUMNS = [
    "ageImprovementZ",
    "wrinklesImprovementZ",
    "volumeImprovementZ",
    "jawlineImprovementZ",
    "improvementScore",
    "improvementPercentile",
]


def to_float(s: str) -> Optional[float]:
    if s is None or s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def domain_age(row: dict) -> Optional[float]:
    """Younger after = improvement → flip sign of years delta."""
    v = to_float(row.get("deltaPredictedFacialAge", ""))
    return None if v is None else -v


def domain_wrinkles(row: dict) -> Optional[float]:
    """Mean of the 7 sub-region severity deltas, sign-flipped."""
    vals = [to_float(row.get(f"{r}Delta", "")) for r in SUB_REGIONS]
    vals = [-v for v in vals if v is not None]
    return statistics.mean(vals) if vals else None


def domain_volume(row: dict) -> Optional[float]:
    """Perception fields (-50..+50) where positive already means better."""
    keys = [
        "perceivedSkinFirmnessDelta",
        "perceivedDensityDelta",
        "perceivedFacialFullnessDelta",
    ]
    vals = [to_float(row.get(k, "")) for k in keys]
    vals = [v for v in vals if v is not None]
    return statistics.mean(vals) if vals else None


def domain_jawline(row: dict) -> Optional[float]:
    """Combine -jawlineLaxityDelta (severity → flip) with perceivedGonialAngleDelta."""
    laxity = to_float(row.get("jawlineLaxityDelta", ""))
    gonial = to_float(row.get("perceivedGonialAngleDelta", ""))
    parts: list[float] = []
    if laxity is not None:
        parts.append(-laxity)
    if gonial is not None:
        parts.append(gonial)
    return statistics.mean(parts) if parts else None


def zscore(values: list[Optional[float]]) -> list[Optional[float]]:
    """Sample std (ddof=1) z-score; preserves None positions."""
    present = [v for v in values if v is not None]
    if len(present) < 2:
        return [0.0 if v is not None else None for v in values]
    mu = statistics.mean(present)
    sd = statistics.stdev(present)
    if sd == 0:
        return [0.0 if v is not None else None for v in values]
    return [None if v is None else (v - mu) / sd for v in values]


def percentile_ranks(values: list[Optional[float]]) -> list[Optional[float]]:
    """Average-rank percentile in [0, 100]; ties get the average rank."""
    indexed = [(i, v) for i, v in enumerate(values) if v is not None]
    if not indexed:
        return [None] * len(values)
    indexed.sort(key=lambda iv: iv[1])
    ranks = [0.0] * len(values)
    n = len(indexed)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        # Average rank for the tie group, 1-based.
        avg_rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg_rank
        i = j + 1
    out: list[Optional[float]] = [None] * len(values)
    for orig_idx, _ in indexed:
        # Convert 1..n rank into 0..100 percentile.
        out[orig_idx] = (ranks[orig_idx] - 1) / max(1, n - 1) * 100
    return out


def fmt(v: Optional[float], places: int = 4) -> str:
    if v is None:
        return ""
    return f"{round(v, places)}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True, help="Path to results.csv (will be updated in place)")
    args = ap.parse_args()

    path = Path(args.csv).expanduser().resolve()
    rows = list(csv.DictReader(path.open("r", newline="", encoding="utf-8")))
    if not rows:
        print("No rows found.")
        return 1

    fieldnames = list(rows[0].keys())
    # Drop any prior copies of the score columns so a re-run produces clean output.
    fieldnames = [c for c in fieldnames if c not in NEW_COLUMNS]
    fieldnames.extend(NEW_COLUMNS)

    age_raw = [domain_age(r) for r in rows]
    wri_raw = [domain_wrinkles(r) for r in rows]
    vol_raw = [domain_volume(r) for r in rows]
    jaw_raw = [domain_jawline(r) for r in rows]

    age_z = zscore(age_raw)
    wri_z = zscore(wri_raw)
    vol_z = zscore(vol_raw)
    jaw_z = zscore(jaw_raw)

    composite: list[Optional[float]] = []
    for a, w, v, j in zip(age_z, wri_z, vol_z, jaw_z):
        parts = [x for x in (a, w, v, j) if x is not None]
        composite.append(statistics.mean(parts) if parts else None)

    pct = percentile_ranks(composite)

    for i, row in enumerate(rows):
        row["ageImprovementZ"] = fmt(age_z[i])
        row["wrinklesImprovementZ"] = fmt(wri_z[i])
        row["volumeImprovementZ"] = fmt(vol_z[i])
        row["jawlineImprovementZ"] = fmt(jaw_z[i])
        row["improvementScore"] = fmt(composite[i])
        row["improvementPercentile"] = fmt(pct[i], 2)

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    # Quick stdout summary.
    scores = [c for c in composite if c is not None]
    print(f"Updated {path} with {len(NEW_COLUMNS)} new columns over {len(rows)} rows.")
    if scores:
        print(
            "improvementScore  "
            f"min={min(scores):+.3f}  "
            f"max={max(scores):+.3f}  "
            f"mean={statistics.mean(scores):+.3f}  "
            f"median={statistics.median(scores):+.3f}  "
            f"std={statistics.stdev(scores):.3f}"
        )

    # Top / bottom 5 for sanity.
    rows_with_score = [(c, r) for c, r in zip(composite, rows) if c is not None]
    rows_with_score.sort(key=lambda cr: cr[0])
    print("\nBottom 5 (worst):")
    for c, r in rows_with_score[:5]:
        print(
            f"  score={c:+.2f}  pct={r['improvementPercentile']:>5}  "
            f"folder={r['folder']:>10}  weeks={r['weeksAfter'] or '?':>3}  "
            f"after={Path(r['afterPath']).name}"
        )
    print("\nTop 5 (best):")
    for c, r in rows_with_score[-5:][::-1]:
        print(
            f"  score={c:+.2f}  pct={r['improvementPercentile']:>5}  "
            f"folder={r['folder']:>10}  weeks={r['weeksAfter'] or '?':>3}  "
            f"after={Path(r['afterPath']).name}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
