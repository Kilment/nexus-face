#!/usr/bin/env bash
#
# Build a frozen cohort reference from raw photos, end to end.
#
# This is the step that makes the Age/Wrinkles/Volume/Jawline z-scores, the
# improvementScore composite and the percentile produce numbers instead of N/A.
# Until a reference exists, those four outputs are unavailable by design —
# standardization needs a population distribution, and inventing one would be
# exactly the fabrication this pipeline is built to avoid.
#
# Usage:
#   scripts/build-reference.sh /path/to/Photos [/path/to/work-dir]
#
# Requires:
#   AI_INTEGRATIONS_OPENAI_API_KEY   canonical preprocessing (standardization)
#   ANTHROPIC_API_KEY                pair scoring
#
# The photos dir needs a manifest.json — see scripts/manifest.example.json.

set -euo pipefail

PHOTOS_DIR="${1:-}"
WORK_DIR="${2:-${PHOTOS_DIR}_standardized}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSV="$REPO_ROOT/scripts/results.csv"
REFERENCE="$REPO_ROOT/scripts/reference/cohort-reference.json"

if [[ -z "$PHOTOS_DIR" ]]; then
  echo "Usage: scripts/build-reference.sh /path/to/Photos [/path/to/work-dir]" >&2
  exit 1
fi

if [[ ! -f "$PHOTOS_DIR/manifest.json" ]]; then
  echo "No manifest.json in $PHOTOS_DIR." >&2
  echo "Copy scripts/manifest.example.json there and edit it." >&2
  exit 1
fi

for var in AI_INTEGRATIONS_OPENAI_API_KEY ANTHROPIC_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "$var is not set." >&2
    exit 1
  fi
done

# Rebuilding the reference changes every score derived from it. Never clobber
# an existing one without the operator saying so.
if [[ -f "$REFERENCE" ]]; then
  echo "A reference already exists at:"
  echo "  $REFERENCE"
  echo
  echo "Rebuilding invalidates every score previously reported against it."
  read -r -p "Overwrite? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
  cp "$REFERENCE" "$REFERENCE.$(date +%Y%m%d%H%M%S).bak"
  echo "Backed up the previous reference."
fi

echo
echo "=== 1/4  Canonical preprocessing (de-id -> 512x512 standardize) ==="
npx tsx "$REPO_ROOT/scripts/standardize-cohort.ts" \
  --photos-dir "$PHOTOS_DIR" \
  --out-dir "$WORK_DIR"

echo
echo "=== 2/4  Scoring every pair against rubric v1.1 ==="
python3 "$REPO_ROOT/scripts/score_pairs.py" \
  --standardized-dir "$WORK_DIR" \
  --out "$CSV"

echo
echo "=== 3/4  Freezing the cohort reference ==="
python3 "$REPO_ROOT/scripts/build_cohort_reference.py" \
  --csv "$CSV" \
  --out "$REFERENCE"

echo
echo "=== 4/4  Applying the reference back to the CSV ==="
python3 "$REPO_ROOT/scripts/compute_improvement_score.py" \
  --csv "$CSV" \
  --reference "$REFERENCE"

echo
echo "Done. The server picks the reference up automatically from:"
echo "  $REFERENCE"
echo
echo "Before reporting any of these numbers, run the controls:"
echo "  python3 scripts/validate_pipeline.py \\"
echo "      --standardized-dir \"$WORK_DIR\" \\"
echo "      --out scripts/reference/validation-report.json"
