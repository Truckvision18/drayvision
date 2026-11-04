#!/usr/bin/env bash
# Reproducible Valhalla tile build from a DATED OSM extract (Phase 4).
#
# Usage:
#   services/routing/build-tiles.sh <path/to/region-YYYY-MM-DD.osm.pbf> [expected-sha256]
#
# - The extract filename MUST contain its snapshot date (YYYY-MM-DD); that date becomes the
#   routing graph version reported by the API's /health endpoint.
# - If a sha256 is given, the build refuses to run on a mismatched file.
# - Output: services/routing/valhalla_tiles/ (git-ignored) + services/routing/data-version.json
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBF="${1:?usage: build-tiles.sh <region-YYYY-MM-DD.osm.pbf> [sha256]}"
EXPECTED_SHA="${2:-}"
IMAGE="ghcr.io/valhalla/valhalla-scripted:${VALHALLA_IMAGE_TAG:-3.5.1}"
OUT="$HERE/valhalla_tiles"

[[ -f "$PBF" ]] || { echo "ERROR: extract not found: $PBF" >&2; exit 1; }

DATE="$(basename "$PBF" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
[[ -n "$DATE" ]] || { echo "ERROR: extract filename must contain its snapshot date (YYYY-MM-DD)" >&2; exit 1; }

SHA="$(sha256sum "$PBF" | cut -d' ' -f1)"
if [[ -n "$EXPECTED_SHA" && "$SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR: sha256 mismatch for $PBF" >&2
  echo "  expected $EXPECTED_SHA" >&2
  echo "  actual   $SHA" >&2
  exit 1
fi

echo "==> Building Valhalla tiles from $(basename "$PBF") (snapshot $DATE, sha256 $SHA)"
mkdir -p "$OUT"
# Fresh build directory — no stale tiles from a previous extract.
find "$OUT" -mindepth 1 -delete
cp "$PBF" "$OUT/"

docker run --rm \
  -v "$OUT:/custom_files" \
  -e serve_tiles=False \
  -e force_rebuild=True \
  -e build_admins=True \
  -e build_time_zones=True \
  -e build_elevation=False \
  "$IMAGE"

cat > "$HERE/data-version.json" <<JSON
{
  "osmExtract": "$(basename "$PBF")",
  "osmExtractDate": "$DATE",
  "sha256": "$SHA",
  "valhallaImage": "$IMAGE",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "==> Done. Graph version $DATE recorded in services/routing/data-version.json"
