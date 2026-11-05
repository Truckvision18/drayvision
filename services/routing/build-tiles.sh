#!/usr/bin/env bash
# Reproducible Valhalla tile build from a DATED OSM extract (Phase 4).
#
# Usage:
#   services/routing/build-tiles.sh <path/to/region-YYYY-MM-DD.osm.pbf> [expected-sha256]
#
# Builders (same Valhalla version either way — keep VALHALLA_VERSION and requirements.txt in step):
#   VALHALLA_BUILDER=docker (default)  ghcr.io/valhalla/valhalla-scripted:$VALHALLA_VERSION
#   VALHALLA_BUILDER=local             valhalla_build_* from `pip install -r services/routing/requirements.txt`
#                                      (no admin / timezone DBs; fine for tests and dev)
#
# - The extract filename MUST contain its snapshot date (YYYY-MM-DD); that date becomes the
#   routing graph version reported by the API's /health and stamped on every route.
# - If a sha256 is given, the build refuses to run on a mismatched file.
# - Output: $VALHALLA_TILES_DIR (default services/routing/valhalla_tiles/, git-ignored) and
#   $DATA_VERSION_FILE (default services/routing/data-version.json).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PBF="${1:?usage: build-tiles.sh <region-YYYY-MM-DD.osm.pbf> [sha256]}"
EXPECTED_SHA="${2:-}"
VALHALLA_VERSION="${VALHALLA_VERSION:-3.9.1}"
BUILDER="${VALHALLA_BUILDER:-docker}"
OUT="${VALHALLA_TILES_DIR:-$HERE/valhalla_tiles}"
DATA_VERSION_FILE="${DATA_VERSION_FILE:-$HERE/data-version.json}"
IMAGE="ghcr.io/valhalla/valhalla-scripted:${VALHALLA_VERSION}"

[[ -f "$PBF" ]] || { echo "ERROR: extract not found: $PBF" >&2; exit 1; }
PBF="$(cd "$(dirname "$PBF")" && pwd)/$(basename "$PBF")"

DATE="$(basename "$PBF" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
[[ -n "$DATE" ]] || { echo "ERROR: extract filename must contain its snapshot date (YYYY-MM-DD)" >&2; exit 1; }

SHA="$(sha256sum "$PBF" | cut -d' ' -f1)"
if [[ -n "$EXPECTED_SHA" && "$SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR: sha256 mismatch for $PBF" >&2
  echo "  expected $EXPECTED_SHA" >&2
  echo "  actual   $SHA" >&2
  exit 1
fi

# Validate the builder and its toolchain BEFORE touching the output directory.
case "$BUILDER" in
  docker)
    command -v docker >/dev/null || { echo "ERROR: docker not found (or use VALHALLA_BUILDER=local)" >&2; exit 1; }
    ;;
  local)
    for bin in valhalla_build_config valhalla_build_tiles; do
      command -v "$bin" >/dev/null || { echo "ERROR: $bin not on PATH — pip install -r services/routing/requirements.txt" >&2; exit 1; }
    done
    INSTALLED="$(python3 -c 'from valhalla import __version__ as v; print(v)' 2>/dev/null || true)"
    if [[ "$INSTALLED" != "$VALHALLA_VERSION" ]]; then
      echo "ERROR: local pyvalhalla is '${INSTALLED:-not importable}' but VALHALLA_VERSION is $VALHALLA_VERSION" >&2
      echo "       (python3 on PATH must be the one pyvalhalla is installed into)" >&2
      exit 1
    fi
    ;;
  *)
    echo "ERROR: VALHALLA_BUILDER must be docker or local (got $BUILDER)" >&2
    exit 1
    ;;
esac

echo "==> Building Valhalla $VALHALLA_VERSION tiles ($BUILDER) from $(basename "$PBF") (snapshot $DATE, sha256 $SHA)"
mkdir -p "$OUT"
# Fresh build directory — never mix tiles from two extracts.
find "$OUT" -mindepth 1 -delete

case "$BUILDER" in
  docker)
    cp "$PBF" "$OUT/"
    docker run --rm \
      -v "$OUT:/custom_files" \
      -e serve_tiles=False \
      -e force_rebuild=True \
      -e build_admins=True \
      -e build_time_zones=True \
      -e build_elevation=False \
      -e build_tar=True \
      "$IMAGE"
    ;;
  local)
    # Named valhalla.local.json (not valhalla.json) so the Docker server, if pointed at this
    # directory, generates its own config with container paths instead of reusing host paths.
    valhalla_build_config \
      --mjolnir-tile-dir "$OUT/valhalla_tiles" \
      --mjolnir-tile-extract "$OUT/valhalla_tiles.tar" \
      --mjolnir-timezone "" \
      --mjolnir-admin "" \
      >"$OUT/valhalla.local.json"
    (cd "$OUT" && valhalla_build_tiles -c "$OUT/valhalla.local.json" "$PBF")
    ;;
esac

mkdir -p "$(dirname "$DATA_VERSION_FILE")"
cat >"$DATA_VERSION_FILE" <<JSON
{
  "osmExtract": "$(basename "$PBF")",
  "osmExtractDate": "$DATE",
  "sha256": "$SHA",
  "valhallaVersion": "$VALHALLA_VERSION",
  "builder": "$BUILDER",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "==> Done. Graph version $DATE recorded in $DATA_VERSION_FILE"
