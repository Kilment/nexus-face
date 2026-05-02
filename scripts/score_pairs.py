"""
Score every BEFORE/AFTER pair in manifest.json with Claude using the same rubric
as server/vision-rubric.ts, and append results to a CSV.

Reproduces the app's `pairMetricsSchema` (see shared/cohort-metrics.ts) — same
field names, same scales, same sign conventions — so the output is directly
comparable to what the in-app pipeline produces with GPT-4o.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python3 scripts/score_pairs.py \\
        --photos-dir "/path/to/Photos" \\
        --out scripts/results.csv

    # Optional flags:
    #   --model claude-sonnet-4-5         (default; override with any vision-capable Claude)
    #   --concurrency 4                   (parallel API calls)
    #   --limit 1                         (smoke-test on a single pair)
    #   --dry-run                         (resolve files only, no API calls)

The script is resumable: pairs already present in the CSV (keyed on
beforePath + afterPath) are skipped on re-run.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Lazy import so --dry-run works without anthropic installed.
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
# Rubric — extends server/vision-rubric.ts with absolute wrinkle scores and a
# per-region anatomic breakdown so each pair yields directly comparable
# before/after numbers per sub-region in addition to deltas.
# ---------------------------------------------------------------------------
RUBRIC_VERSION = "score_pairs.py rubric v1.1 (extends vision-rubric.ts@1.0)"
SCRIPT_VERSION = "score_pairs.py v1.1"

SUB_REGIONS = [
    "crowsFeet",          # periorbital fine lines
    "nasolabialFolds",    # cheek-to-mouth folds
    "foreheadLines",      # horizontal forehead wrinkles
    "glabellarLines",     # vertical lines between brows ("11s")
    "perioralLines",      # vertical lip lines
    "underEyeHollows",    # tear-trough / infraorbital hollowing
    "jawlineLaxity",      # jowling / loss of mandibular definition
]

RUBRIC_PROMPT = """You are assisting with exploratory research image comparison (not clinical diagnosis).
Compare BEFORE (first image) vs AFTER (second image) standardized face portraits.

Score on these scales:
- Predicted facial age (years): estimate independently for each image; delta = AFTER minus BEFORE.
- Overall wrinkles AND subclinical (fine/early) wrinkle appearance: 0–100 severity per image (0 = none, 100 = severe); delta = AFTER minus BEFORE (negative = improvement).
- Perceived skin firmness, density, facial fullness: each on −50..+50 delta where 0=no change, positive=better firmness/density/fullness appearance.
- Perceived gonial (jaw) angle opening appearance: delta in approximate degrees (−10..+10).
- Per anatomic sub-region (crowsFeet, nasolabialFolds, foreheadLines, glabellarLines, perioralLines, underEyeHollows, jawlineLaxity): rate each on 0–100 severity per image (0 = none, 100 = severe); delta = AFTER minus BEFORE (negative = improvement).
- Confidence: 0..1 self-rated confidence in the comparison.

Respond ONLY with valid JSON matching this TypeScript shape (numbers only for scored fields):
{
  "predictedFacialAgeBefore": number,
  "predictedFacialAgeAfter": number,
  "deltaPredictedFacialAge": number,
  "wrinklesBefore": number,
  "wrinklesAfter": number,
  "deltaWrinkles": number,
  "subclinicalWrinklesBefore": number,
  "subclinicalWrinklesAfter": number,
  "deltaSubclinicalWrinkles": number,
  "perceivedSkinFirmnessDelta": number,
  "perceivedDensityDelta": number,
  "perceivedFacialFullnessDelta": number,
  "perceivedGonialAngleDelta": number,
  "subRegions": {
    "crowsFeet":        { "before": number, "after": number, "delta": number },
    "nasolabialFolds":  { "before": number, "after": number, "delta": number },
    "foreheadLines":    { "before": number, "after": number, "delta": number },
    "glabellarLines":   { "before": number, "after": number, "delta": number },
    "perioralLines":    { "before": number, "after": number, "delta": number },
    "underEyeHollows":  { "before": number, "after": number, "delta": number },
    "jawlineLaxity":    { "before": number, "after": number, "delta": number }
  },
  "confidence": number,
  "notes": string
}"""

# Top-level scored fields in the CSV (flat — sub-region fields are added below).
METRIC_FIELDS = [
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
    "confidence",
    "notes",
]

# Per-region columns: e.g. crowsFeetBefore, crowsFeetAfter, crowsFeetDelta
SUBREGION_FIELDS: list[str] = []
for r in SUB_REGIONS:
    SUBREGION_FIELDS.extend([f"{r}Before", f"{r}After", f"{r}Delta"])

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
    "model",
    "scoredAt",
    "pipelineNotes",
    "error",
]


# ---------------------------------------------------------------------------
# File resolution — handles trailing whitespace in folder names and the
# "01.20.23.jpeg" vs "1.20.23.jpeg" leading-zero variants we observed.
# ---------------------------------------------------------------------------
def build_folder_index(photos_dir: Path) -> dict[str, Path]:
    """Map manifest folder name (stripped) → actual folder Path."""
    idx: dict[str, Path] = {}
    for entry in photos_dir.iterdir():
        if entry.is_dir():
            idx[entry.name.strip()] = entry
    return idx


def resolve_photo_path(actual_folder: Path, relative_path: str) -> Optional[Path]:
    """Try several spelling variants for the file inside its cohort folder."""
    parts = relative_path.split("/", 1)
    fname = parts[1] if len(parts) > 1 else relative_path
    candidates = [
        fname,
        fname.strip(),
    ]
    # Day-component leading-zero variants: "01.20.23.jpeg" ↔ "1.20.23.jpeg"
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(\..+)$", fname.strip())
    if m:
        mm, dd, yy, ext = m.groups()
        for mvar in {mm, mm.lstrip("0") or "0", mm.zfill(2)}:
            for dvar in {dd, dd.lstrip("0") or "0", dd.zfill(2)}:
                candidates.append(f"{mvar}.{dvar}.{yy}{ext}")
    for c in candidates:
        p = actual_folder / c
        if p.is_file():
            return p
    return None


# ---------------------------------------------------------------------------
# Pair model
# ---------------------------------------------------------------------------
@dataclass
class Pair:
    studyTitle: str
    folder: str
    initials: str
    locationCode: str
    beforeRelative: str
    afterRelative: str
    beforePath: Path
    afterPath: Path
    weeksAfter: Optional[int]


def enumerate_pairs(manifest: dict, photos_dir: Path) -> tuple[list[Pair], list[dict]]:
    """Return (resolved_pairs, skipped_records)."""
    folder_idx = build_folder_index(photos_dir)
    pairs: list[Pair] = []
    skipped: list[dict] = []

    for cohort in manifest["cohorts"]:
        folder_key = cohort["folder"].strip()
        actual_folder = folder_idx.get(folder_key)
        if actual_folder is None:
            skipped.append({"folder": cohort["folder"], "reason": "folder_not_on_disk"})
            continue

        before = next((p for p in cohort["photos"] if p["role"] == "before"), None)
        afters = [p for p in cohort["photos"] if p["role"] == "after"]
        if not before:
            skipped.append({"folder": cohort["folder"], "reason": "no_before_photo"})
            continue

        before_path = resolve_photo_path(actual_folder, before["relativePath"])
        if before_path is None:
            skipped.append(
                {
                    "folder": cohort["folder"],
                    "relativePath": before["relativePath"],
                    "reason": "before_file_missing",
                }
            )
            continue

        for after in afters:
            after_path = resolve_photo_path(actual_folder, after["relativePath"])
            if after_path is None:
                skipped.append(
                    {
                        "folder": cohort["folder"],
                        "relativePath": after["relativePath"],
                        "reason": "after_file_missing",
                    }
                )
                continue

            pairs.append(
                Pair(
                    studyTitle=cohort.get("studyTitle", ""),
                    folder=cohort["folder"],
                    initials=cohort.get("initials", ""),
                    locationCode=cohort.get("locationCode", ""),
                    beforeRelative=before["relativePath"],
                    afterRelative=after["relativePath"],
                    beforePath=before_path,
                    afterPath=after_path,
                    weeksAfter=after.get("weeksAfter"),
                )
            )

    return pairs, skipped


# ---------------------------------------------------------------------------
# Scoring — calls Anthropic API with the same rubric the app uses.
# ---------------------------------------------------------------------------
# Anthropic vision endpoint accepts up to 5 MB per image; base64 inflates raw bytes
# by ~33%, so we cap raw payload at ~3.7 MB to stay under the limit safely.
MAX_RAW_BYTES = 3_700_000
INITIAL_LONG_EDGE = 1600  # px — plenty of detail for facial rubric scoring


def encode_image(path: Path) -> tuple[str, str]:
    """Return (media_type, base64), downscaling/recompressing if the file would
    exceed Anthropic's 5 MB-per-image limit."""
    raw = path.read_bytes()
    ext = path.suffix.lower().lstrip(".")
    media_type = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }.get(ext, "image/jpeg")

    if len(raw) <= MAX_RAW_BYTES:
        return media_type, base64.standard_b64encode(raw).decode("ascii")

    # Need to shrink. Always re-encode as JPEG quality 85, fitting within a
    # progressively smaller long-edge until under the cap.
    from PIL import Image  # local import keeps --dry-run light

    img = Image.open(path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    long_edge = INITIAL_LONG_EDGE
    quality = 85
    for _ in range(8):
        w, h = img.size
        scale = long_edge / max(w, h)
        if scale < 1:
            resized = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        else:
            resized = img
        from io import BytesIO

        buf = BytesIO()
        resized.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= MAX_RAW_BYTES:
            return "image/jpeg", base64.standard_b64encode(data).decode("ascii")
        # Tighten parameters and retry.
        if quality > 60:
            quality -= 10
        else:
            long_edge = max(640, int(long_edge * 0.8))
    raise RuntimeError(f"Could not compress {path} below {MAX_RAW_BYTES} bytes")


def extract_json(text: str) -> dict:
    """Pull the first {...} JSON object out of the model's response."""
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError(f"No JSON object found in response: {text[:300]!r}")
    return json.loads(m.group(0))


def _coerce_number(v):
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return v


def normalize_metrics(raw: dict) -> dict:
    """Coerce model output to the flat CSV shape (top-level + flattened sub-regions)."""
    out: dict = {}
    for k in METRIC_FIELDS:
        v = raw.get(k)
        if k == "notes":
            out[k] = "" if v is None else str(v)
            continue
        v = _coerce_number(v)
        if k == "confidence" and isinstance(v, (int, float)):
            # Match vision-rubric.ts: clamp to 0..1, accept 0..100 percent inputs.
            if v > 1:
                v = v / 100.0
            v = max(0.0, min(1.0, v))
        out[k] = v

    sub = raw.get("subRegions") or {}
    for region in SUB_REGIONS:
        block = sub.get(region) or {}
        for suffix, jsonkey in (("Before", "before"), ("After", "after"), ("Delta", "delta")):
            out[f"{region}{suffix}"] = _coerce_number(block.get(jsonkey))
    return out


def score_pair(client, model: str, pair: Pair, max_retries: int = 4) -> dict:
    before_mt, before_b64 = encode_image(pair.beforePath)
    after_mt, after_b64 = encode_image(pair.afterPath)

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Image 1 is BEFORE. Image 2 is AFTER."},
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": before_mt,
                        "data": before_b64,
                    },
                },
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": after_mt,
                        "data": after_b64,
                    },
                },
            ],
        }
    ]

    last_err: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=1024,
                temperature=0,
                system=RUBRIC_PROMPT,
                messages=messages,
            )
            text_blocks = [
                b.text for b in resp.content if getattr(b, "type", None) == "text"
            ]
            raw_text = "".join(text_blocks)
            parsed = extract_json(raw_text)
            return normalize_metrics(parsed)
        except Exception as e:  # noqa: BLE001
            last_err = e
            sleep_s = min(30, 2**attempt)
            time.sleep(sleep_s)
    raise RuntimeError(f"score_pair failed after {max_retries} attempts: {last_err}")


# ---------------------------------------------------------------------------
# CSV I/O — resumable.
# ---------------------------------------------------------------------------
def load_done_keys(csv_path: Path) -> set[tuple[str, str]]:
    if not csv_path.exists():
        return set()
    done: set[tuple[str, str]] = set()
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("error"):
                continue  # let prior failures be retried
            key = (row.get("beforePath", ""), row.get("afterPath", ""))
            if key != ("", ""):
                done.add(key)
    return done


def append_row(csv_path: Path, row: dict, lock: threading.Lock) -> None:
    with lock:
        # Treat an absent OR empty file as needing a header.
        needs_header = (not csv_path.exists()) or csv_path.stat().st_size == 0
        with csv_path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_HEADER, extrasaction="ignore")
            if needs_header:
                writer.writeheader()
            writer.writerow(row)


def pair_to_row(pair: Pair, metrics: Optional[dict], model: str, error: str = "") -> dict:
    row = {
        "studyTitle": pair.studyTitle,
        "folder": pair.folder,
        "initials": pair.initials,
        "locationCode": pair.locationCode,
        "interventionLabel": "",  # populated by post-hoc CSV join with intervention sidecar
        "beforePath": str(pair.beforePath),
        "afterPath": str(pair.afterPath),
        "weeksAfter": "" if pair.weeksAfter is None else pair.weeksAfter,
        "model": model,
        "scoredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pipelineNotes": f"{RUBRIC_VERSION}; {SCRIPT_VERSION}; model={model}",
        "error": error,
    }
    for k in METRIC_FIELDS:
        row[k] = "" if not metrics else (metrics.get(k) if metrics.get(k) is not None else "")
    for k in SUBREGION_FIELDS:
        row[k] = "" if not metrics else (metrics.get(k) if metrics.get(k) is not None else "")
    return row


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photos-dir", required=True, help="Folder containing manifest.json + cohort subfolders")
    parser.add_argument("--manifest", default=None, help="Path to manifest.json (defaults to photos-dir/manifest.json)")
    parser.add_argument("--out", required=True, help="CSV output path")
    parser.add_argument("--model", default=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5"))
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--limit", type=int, default=None, help="Score at most N pairs (smoke test)")
    parser.add_argument("--dry-run", action="store_true", help="Resolve files only; no API calls")
    args = parser.parse_args()

    photos_dir = Path(args.photos_dir).expanduser().resolve()
    manifest_path = Path(args.manifest) if args.manifest else photos_dir / "manifest.json"
    out_path = Path(args.out).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(manifest_path.read_text())
    pairs, skipped = enumerate_pairs(manifest, photos_dir)

    print(f"Manifest: {manifest_path}")
    print(f"Photos dir: {photos_dir}")
    print(f"Resolved pairs: {len(pairs)}")
    print(f"Skipped (missing files/folders): {len(skipped)}")
    for s in skipped:
        print(f"  SKIP {s}")

    if args.limit is not None:
        pairs = pairs[: args.limit]
        print(f"--limit applied: scoring {len(pairs)} pairs")

    done_keys = load_done_keys(out_path)
    todo = [p for p in pairs if (str(p.beforePath), str(p.afterPath)) not in done_keys]
    print(f"Already scored in CSV: {len(pairs) - len(todo)}")
    print(f"To score this run: {len(todo)}")

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

    def work(pair: Pair) -> tuple[Pair, Optional[dict], str]:
        try:
            metrics = score_pair(client, args.model, pair)
            return pair, metrics, ""
        except Exception as e:  # noqa: BLE001
            return pair, None, str(e)

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as ex:
        futures = [ex.submit(work, p) for p in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            pair, metrics, err = fut.result()
            row = pair_to_row(pair, metrics, args.model, error=err)
            append_row(out_path, row, write_lock)
            if err:
                failed += 1
                print(f"[{i}/{len(todo)}] FAIL {pair.folder} after={pair.afterRelative}: {err}")
            else:
                success += 1
                print(
                    f"[{i}/{len(todo)}] OK   {pair.folder} after={pair.afterRelative} "
                    f"ΔAge={metrics.get('deltaPredictedFacialAge')} "
                    f"ΔWrinkles={metrics.get('deltaWrinkles')}"
                )

    print(f"\nDone. success={success} failed={failed} csv={out_path}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
