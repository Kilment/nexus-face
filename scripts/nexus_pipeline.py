"""
Shared pipeline primitives for the research scripts.

Everything here mirrors a specific piece of the server implementation so the
batch path and the in-app path produce comparable numbers:

  * RUBRIC          <- shared/rubric.v1.1.json (the same file server/vision-rubric.ts reads)
  * harmonize_pair  <- server/vision-rubric.ts harmonizePairLighting
  * validation      <- shared/cohort-metrics.ts pairMetricsSchema ranges
  * domains         <- shared/improvement-score.ts

Do not fork these. If a rule changes it changes in the shared artifact and both
sides pick it up.
"""

from __future__ import annotations

import base64
import json
import math
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
RUBRIC_PATH = REPO_ROOT / "shared" / "rubric.v1.1.json"

with RUBRIC_PATH.open("r", encoding="utf-8") as _f:
    RUBRIC: dict[str, Any] = json.load(_f)

RUBRIC_VERSION: str = RUBRIC["rubricVersion"]
RUBRIC_PROMPT: str = RUBRIC["prompt"]
USER_TURN_TEXT: str = RUBRIC["userTurnText"]
SUB_REGIONS: list[str] = [r["key"] for r in RUBRIC["subRegions"]]
RANGES: dict[str, list[float]] = RUBRIC["ranges"]

# Must match shared/cohort-metrics.ts PREPROCESSING_VERSION.
PREPROCESSING_VERSION = "deid+standardize512+harmonize@1.0.0"

NOT_AVAILABLE = "N/A"

SCALAR_FIELDS = [
    "predictedFacialAgeBefore",
    "predictedFacialAgeAfter",
    "deltaPredictedFacialAge",
    "wrinklesBefore",
    "wrinklesAfter",
    "deltaWrinkles",
    "subclinicalWrinklesBefore",
    "subclinicalWrinklesAfter",
    "deltaSubclinicalWrinkles",
    "perceivedSkinFirmnessDelta",
    "perceivedDensityDelta",
    "perceivedFacialFullnessDelta",
    "perceivedGonialAngleDelta",
]


# ---------------------------------------------------------------------------
# Lighting harmonization — line-for-line port of harmonizePairLighting in
# server/vision-rubric.ts, including its clamps. A different normalization here
# would mean the model sees different pixels than the app shows it.
# ---------------------------------------------------------------------------
def _luminance_stats(rgb: np.ndarray, alpha: Optional[np.ndarray]) -> tuple[float, float]:
    """Return (mean, stdDev) of luminance over non-transparent pixels."""
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    if alpha is not None:
        lum = lum[alpha != 0]
    else:
        lum = lum.reshape(-1)

    if lum.size == 0:
        return 128.0, 1.0

    mean = float(lum.mean())
    # Matches the TS `Math.max(1, sumSq/count - mean*mean)` guard.
    variance = max(1.0, float((lum.astype(np.float64) ** 2).mean()) - mean * mean)
    return mean, math.sqrt(variance)


def _apply_target_luminance(
    rgb: np.ndarray,
    alpha: Optional[np.ndarray],
    source: tuple[float, float],
    target: tuple[float, float],
) -> np.ndarray:
    source_mean, source_std = source
    target_mean, target_std = target

    std_ratio = max(0.6, min(1.8, target_std / max(1.0, source_std)))
    mean_delta = target_mean - source_mean

    adjusted = (rgb.astype(np.float64) - source_mean) * std_ratio + source_mean + mean_delta
    adjusted = np.clip(adjusted, 0, 255)

    if alpha is not None:
        mask = (alpha != 0)[..., None]
        adjusted = np.where(mask, adjusted, rgb.astype(np.float64))

    return adjusted.astype(np.uint8)


def _load_rgba(path: Path) -> tuple[np.ndarray, Optional[np.ndarray]]:
    img = Image.open(path)
    if img.mode == "RGBA":
        arr = np.array(img)
        return arr[..., :3], arr[..., 3]
    return np.array(img.convert("RGB")), None


def harmonize_pair(before_path: Path, after_path: Path) -> tuple[str, str]:
    """
    Normalize both images toward their shared mean luminance/contrast, then
    return (before_b64_png, after_b64_png).
    """
    before_rgb, before_a = _load_rgba(before_path)
    after_rgb, after_a = _load_rgba(after_path)

    before_stats = _luminance_stats(before_rgb, before_a)
    after_stats = _luminance_stats(after_rgb, after_a)
    target = (
        (before_stats[0] + after_stats[0]) / 2,
        (before_stats[1] + after_stats[1]) / 2,
    )

    before_out = _apply_target_luminance(before_rgb, before_a, before_stats, target)
    after_out = _apply_target_luminance(after_rgb, after_a, after_stats, target)

    def to_b64(arr: np.ndarray) -> str:
        buf = BytesIO()
        Image.fromarray(arr, mode="RGB").save(buf, format="PNG")
        return base64.standard_b64encode(buf.getvalue()).decode("ascii")

    return to_b64(before_out), to_b64(after_out)


# ---------------------------------------------------------------------------
# Response normalization + validation
# ---------------------------------------------------------------------------
NULL_TOKENS = {"", "n/a", "na", "null", "none", "unknown", "undetermined"}


def coerce_score(value: Any) -> Optional[float]:
    """Numbers pass through; null-ish tokens and junk become None (= N/A)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if isinstance(value, str):
        if value.strip().lower() in NULL_TOKENS:
            return None
        try:
            v = float(value.strip())
        except ValueError:
            return None
        return v if math.isfinite(v) else None
    return None


def coerce_confidence(value: Any) -> Optional[float]:
    v = coerce_score(value)
    if v is None:
        return None
    scaled = v / 100.0 if v > 1 else v
    return max(0.0, min(1.0, scaled))


def normalize_metrics(raw: dict) -> dict:
    """Flatten the model response into the CSV column shape."""
    out: dict[str, Any] = {}
    for key in SCALAR_FIELDS:
        out[key] = coerce_score(raw.get(key))
    out["confidence"] = coerce_confidence(raw.get("confidence"))
    notes = raw.get("notes")
    out["notes"] = "" if notes is None else str(notes)

    sub = raw.get("subRegions") or {}
    for region in SUB_REGIONS:
        block = sub.get(region) or {}
        out[f"{region}Before"] = coerce_score(block.get("before"))
        out[f"{region}After"] = coerce_score(block.get("after"))
        out[f"{region}Delta"] = coerce_score(block.get("delta"))
    return out


def _in_range(value: float, bounds: list[float]) -> bool:
    return bounds[0] <= value <= bounds[1]


def find_range_violations(metrics: dict) -> list[str]:
    """Out-of-scale values mean the model ignored the rubric; never clamp them."""
    problems: list[str] = []

    for key in SCALAR_FIELDS:
        v = metrics.get(key)
        if v is None or key not in RANGES:
            continue
        if not _in_range(v, RANGES[key]):
            problems.append(f"{key}={v} outside {RANGES[key]}")

    conf = metrics.get("confidence")
    if conf is not None and not _in_range(conf, RANGES["confidence"]):
        problems.append(f"confidence={conf} outside {RANGES['confidence']}")

    for region in SUB_REGIONS:
        for suffix, bounds_key in (
            ("Before", "subRegionSeverity"),
            ("After", "subRegionSeverity"),
            ("Delta", "subRegionDelta"),
        ):
            v = metrics.get(f"{region}{suffix}")
            if v is None:
                continue
            if not _in_range(v, RANGES[bounds_key]):
                problems.append(f"{region}{suffix}={v} outside {RANGES[bounds_key]}")

    return problems


def find_self_consistency_violations(metrics: dict) -> list[str]:
    """
    The model reports deltas independently of the before/after values it also
    reports. Disagreement means the response is internally inconsistent —
    surface it rather than silently picking one.
    """
    problems: list[str] = []

    for check in RUBRIC["selfConsistency"]["checks"]:
        delta = metrics.get(check["delta"])
        after = metrics.get(check["after"])
        before = metrics.get(check["before"])
        if delta is None or after is None or before is None:
            continue
        implied = after - before
        if abs(implied - delta) > check["tolerance"]:
            problems.append(
                f"{check['delta']}={delta} disagrees with "
                f"{check['after']}-{check['before']}={implied:.2f}"
            )

    tol = RUBRIC["selfConsistency"]["subRegionTolerance"]
    for region in SUB_REGIONS:
        before = metrics.get(f"{region}Before")
        after = metrics.get(f"{region}After")
        delta = metrics.get(f"{region}Delta")
        if before is None or after is None or delta is None:
            continue
        implied = after - before
        if abs(implied - delta) > tol:
            problems.append(
                f"{region}Delta={delta} disagrees with after-before={implied:.2f}"
            )

    return problems


# ---------------------------------------------------------------------------
# Improvement-score domains — must match shared/improvement-score.ts exactly.
# A domain requires ALL of its inputs; a partial mean is a different estimator
# and would not be comparable to the frozen reference.
# ---------------------------------------------------------------------------
DOMAIN_KEYS = ["age", "wrinkles", "volume", "jawline"]


def _all_present(values: list[Optional[float]]) -> Optional[list[float]]:
    out: list[float] = []
    for v in values:
        if v is None or not math.isfinite(v):
            return None
        out.append(v)
    return out


def domain_age(row: dict) -> Optional[float]:
    """Younger after = improvement, so the years delta is sign-flipped."""
    v = row.get("deltaPredictedFacialAge")
    return None if v is None else -v


def domain_wrinkles(row: dict) -> Optional[float]:
    """Mean of all seven sub-region deltas, sign-flipped. Requires every region."""
    deltas = _all_present([row.get(f"{r}Delta") for r in SUB_REGIONS])
    if deltas is None:
        return None
    return float(np.mean([-d for d in deltas]))


def domain_volume(row: dict) -> Optional[float]:
    vals = _all_present(
        [
            row.get("perceivedSkinFirmnessDelta"),
            row.get("perceivedDensityDelta"),
            row.get("perceivedFacialFullnessDelta"),
        ]
    )
    return None if vals is None else float(np.mean(vals))


def domain_jawline(row: dict) -> Optional[float]:
    vals = _all_present(
        [row.get("jawlineLaxityDelta"), row.get("perceivedGonialAngleDelta")]
    )
    if vals is None:
        return None
    laxity, gonial = vals
    return float(np.mean([-laxity, gonial]))


def compute_raw_domains(row: dict) -> dict[str, Optional[float]]:
    return {
        "age": domain_age(row),
        "wrinkles": domain_wrinkles(row),
        "volume": domain_volume(row),
        "jawline": domain_jawline(row),
    }


def fmt(value: Optional[float], places: int = 4) -> str:
    """CSV rendering: an undetermined value is N/A, never blank and never 0."""
    if value is None or not math.isfinite(value):
        return NOT_AVAILABLE
    rounded = round(value, places)
    # Sign-flipping a zero delta yields -0.0, which renders as "-0.0" and reads
    # like a tiny improvement. Collapse it to plain 0.
    if rounded == 0:
        rounded = 0.0
    return f"{rounded}"


def parse_csv_value(raw: Optional[str]) -> Optional[float]:
    """Inverse of fmt() — treats N/A and blanks as missing."""
    if raw is None:
        return None
    s = raw.strip()
    if s.lower() in NULL_TOKENS:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None
