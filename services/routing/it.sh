#!/usr/bin/env bash
# Routing integration test: real Valhalla on the synthetic ladder network.
#
#   1. generate fixtures/ladder.json -> dated .osm.pbf (pyosmium)
#   2. build tiles with the LOCAL builder (pyvalhalla, same version as the Docker image)
#   3. start valhalla_service on a free local port
#   4. run services/routing/test/*.it.test.ts against it (vitest), then stop the service
#
# Needs: pip install -r services/routing/requirements.txt (a venv on PATH is fine).
# Everything is written to a temp dir — nothing touches services/routing/valhalla_tiles.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${VALHALLA_IT_PORT:-8902}"
WORK="$(mktemp -d)"
PY="${PYTHON:-python3}"
SVC_PGID_FILE="$WORK/service.pgid"

cleanup() {
  # The service runs in its own process group (setsid) so the pip wrapper AND the real binary stop.
  if [[ -s "$SVC_PGID_FILE" ]]; then
    local pgid
    pgid="$(cat "$SVC_PGID_FILE")"
    # valhalla_service ignores SIGTERM (only the pip wrapper exits), so escalate to SIGKILL.
    kill -TERM -- "-$pgid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6; do
      kill -0 -- "-$pgid" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
  if [[ "${IT_KEEP:-0}" == "1" ]]; then
    echo "IT_KEEP=1: work dir kept at $WORK (tiles, logs)"
  else
    find "$WORK" -mindepth 1 -delete 2>/dev/null || true
    rmdir "$WORK" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if curl -fsS "http://127.0.0.1:$PORT/status" >/dev/null 2>&1; then
  echo "ERROR: something is already serving on port $PORT (a stale valhalla_service?). Stop it or set VALHALLA_IT_PORT." >&2
  exit 1
fi
command -v valhalla_service >/dev/null || { echo "ERROR: valhalla_service not on PATH — pip install -r services/routing/requirements.txt" >&2; exit 1; }

echo "==> Generating synthetic fixture network"
PBF="$("$PY" -I "$HERE/fixtures/make_fixture.py" "$WORK/extract")"

echo "==> Building tiles (local builder)"
VALHALLA_BUILDER=local VALHALLA_TILES_DIR="$WORK/tiles" DATA_VERSION_FILE="$WORK/data-version.json" \
  "$HERE/build-tiles.sh" "$PBF" >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }

# Own port, and own IPC socket paths (Valhalla defaults to ipc:///tmp/*, which collides with any
# other instance on the machine).
"$PY" -I - "$WORK/tiles/valhalla.local.json" "$PORT" "$WORK" <<'PYEOF'
import json, sys
path, port, work = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read().replace("ipc:///tmp/", f"ipc://{work}/")
cfg = json.loads(text)
cfg["httpd"]["service"]["listen"] = f"tcp://127.0.0.1:{port}"
json.dump(cfg, open(path, "w"), indent=1)
PYEOF

echo "==> Starting valhalla_service on :$PORT"
# setsid may fork, so the session leader records its own id (= process group id) for cleanup.
setsid bash -c 'echo $$ >"$3"; cd "$1" && exec valhalla_service "$2" 1' _ "$WORK" "$WORK/tiles/valhalla.local.json" "$SVC_PGID_FILE" \
  >"$WORK/service.log" 2>&1 &
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/status" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/status" >/dev/null || { echo "ERROR: valhalla_service did not start"; tail -30 "$WORK/service.log"; exit 1; }

echo "==> Running routing integration tests"
cd "$ROOT"
VALHALLA_IT_URL="http://127.0.0.1:$PORT" VALHALLA_IT_DATA_VERSION="$WORK/data-version.json" \
  npx vitest run --config services/routing/vitest.it.config.ts
