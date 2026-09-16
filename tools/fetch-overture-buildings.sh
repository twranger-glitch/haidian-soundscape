#!/usr/bin/env bash
set -euo pipefail
# Download Overture building + building_part for one bbox and record the exact
# release reported by the official CLI at build time.
#
# Usage:
#   fetch-overture-buildings.sh WEST SOUTH EAST NORTH OUT_BUILDINGS.geojson [OUT_PARTS.geojson] [META.json]
#
# The 5-argument form remains backward compatible and writes only buildings.
if [[ $# -lt 5 || $# -gt 7 ]]; then
  echo "usage: $0 WEST SOUTH EAST NORTH OUT_BUILDINGS.geojson [OUT_PARTS.geojson] [META.json]" >&2
  exit 2
fi
WEST="$1"; SOUTH="$2"; EAST="$3"; NORTH="$4"; OUT="$5"
PARTS="${6:-}"
META="${7:-}"
if ! command -v overturemaps >/dev/null 2>&1; then
  echo "overturemaps CLI is required: pip install overturemaps" >&2
  exit 3
fi
mkdir -p "$(dirname "$OUT")"
[[ -z "$PARTS" ]] || mkdir -p "$(dirname "$PARTS")"
RELEASE="$(overturemaps releases latest 2>/dev/null | tail -n 1 | tr -d '[:space:]' || true)"
[[ -n "$RELEASE" ]] || RELEASE="latest-at-build-time"
BBOX="${WEST},${SOUTH},${EAST},${NORTH}"
overturemaps download --bbox="$BBOX" -f geojson --type=building -o "$OUT"
if [[ -n "$PARTS" ]]; then
  overturemaps download --bbox="$BBOX" -f geojson --type=building_part -o "$PARTS"
fi
if [[ -n "$META" ]]; then
  python3 - "$META" "$RELEASE" "$BBOX" "$OUT" "$PARTS" <<'PY'
import json, os, sys, datetime
path, release, bbox, buildings, parts = sys.argv[1:]
obj = {
  "source": "Overture Maps Foundation",
  "release": release,
  "bbox": [float(x) for x in bbox.split(',')],
  "downloaded_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "buildings_file": buildings,
  "building_parts_file": parts or None,
}
with open(path, 'w', encoding='utf-8') as f: json.dump(obj, f, ensure_ascii=False, indent=2)
PY
fi
echo "Overture release=${RELEASE} bbox=${BBOX} buildings=${OUT}${PARTS:+ parts=${PARTS}}"
