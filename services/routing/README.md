# Routing (Phase 4): self-hosted Valhalla

DrayVision runs its own Valhalla **3.9.1** truck router. OSM extracts are data, not code. They
live in `extracts/`, which git ignores, and they are never committed. Every tile build can be
reproduced from a **dated** extract plus its sha256. The date becomes the routing graph version
reported by `/health` and stamped on every route.

## Building tiles for a real region

```bash
# 1. Download a dated extract into extracts/, putting its snapshot date in the filename,
#    e.g. extracts/new-york-2026-11-01.osm.pbf (Geofabrik publishes dated snapshots).
#    Record its sha256 in your run log.
sha256sum services/routing/extracts/new-york-2026-11-01.osm.pbf

# 2. Build tiles (Docker builder: also builds the admin + timezone DBs)
make tiles EXTRACT=services/routing/extracts/new-york-2026-11-01.osm.pbf SHA=<sha256>

# 3. Serve tiles on :8002. The api container reaches Valhalla at http://valhalla:8002.
make up-routing
curl localhost:8080/health      # dataVersions.routingGraph = 2026-11-01, routing = up
```

The build writes `valhalla_tiles/` and `data-version.json` (both git-ignored). The server
container serves those tiles read-only and never rebuilds when it starts.

### Two builders, same Valhalla version

| `VALHALLA_BUILDER` | Uses | Notes |
|---|---|---|
| `docker` (default) | `ghcr.io/valhalla/valhalla-scripted:3.9.1` | Builds the admin + timezone DBs. Use this for pilot/prod graphs. |
| `local` | `pyvalhalla==3.9.1` from `requirements.txt` | No Docker needed. Skips the admin/timezone DBs. Fine for dev and tests. |

`build-tiles.sh` refuses to build if the installed `pyvalhalla` version differs from
`VALHALLA_VERSION`. It also checks the builder and toolchain *before* clearing the output
directory, so a bad invocation never wipes a working tile set. The image tag, `requirements.txt`
and the default `VALHALLA_VERSION` must be bumped together.

## How truck routing is configured

- **Hard limits** come from the driver's `TruckProfile`: height, width, length, weight, axle
  load, axle count and hazmat. The API maps the profile onto Valhalla `truck` costing
  (`services/api/src/providers/valhalla.ts`).
- **Preferences** come from config (`routing.truckCosting` in `services/api/config/`):
  `use_highways`, `use_tolls`, `use_living_streets`, `use_tracks` and `top_speed`. Alternatives
  are set by `routing.alternates`.
- **The engine is not trusted on its own.** Every route and every alternative is re-checked
  against our verified restriction dataset by the Phase 5 safety layer, and routes that fail are
  never offered.
- Valhalla's "no route" answers (`171` no road near a point, `442` no path, and so on) become an
  HTTP **422** carrying the reason. If the engine is unreachable or broken, the API returns a
  **502**.

## Integration tests on a real engine

```bash
python3 -m venv .venv && . .venv/bin/activate
make routing-deps
make routing-it
```

`it.sh` generates a **synthetic** network from `fixtures/ladder.json`. It's a five-row "ladder"
near Null Island, and three rows each carry one restriction in their middle segment: a 3.5 m
low bridge, `hgv=no` (no trucks), and a 10 t weight limit. The script builds tiles with the
local builder, starts `valhalla_service` on a private port with private IPC sockets, and runs
`test/routing.it.test.ts`:

- **Golden cases** (`fixtures/golden.json`): a tall rig avoids the low bridge and a short one
  goes under it. Every rig avoids `hgv=no`. A loaded rig avoids the weight limit and a light one
  uses it. When a case must avoid a restriction, every alternative must avoid it too.
- The maneuvers carry voice text, and their shape indices cover the whole geometry with no gaps.
- **Through the API:** only validated routes are returned, and the safety layer flags a bridge
  that the engine's OSM data rates as passable (for example, when our verified clearance is lower).
- A point off the road network returns 422.

`IT_KEEP=1 make routing-it` keeps the work directory (tiles and logs) for debugging. Note that
`valhalla_service` ignores SIGTERM, so `it.sh` sends SIGKILL to its process group on exit.

The synthetic network checks that the **engine and our wiring** behave. Real-world golden routes
(actual bridges and parkways) belong in `data/test-routes/` and must come from verified sources.
