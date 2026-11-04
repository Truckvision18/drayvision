# Routing (Phase 4) — self-hosted Valhalla

OSM extracts are **data, not code**: they live in `extracts/` (git-ignored) and are never
committed. Each build is reproducible from a dated extract plus its sha256.

```bash
# 1. Download a dated extract (e.g. from Geofabrik) into extracts/, naming it with its date
#    e.g. extracts/new-york-2026-11-01.osm.pbf, and record its sha256 in your run log.
# 2. Build tiles
services/routing/build-tiles.sh services/routing/extracts/new-york-2026-11-01.osm.pbf <sha256>
# 3. Serve
docker compose -f infra/docker-compose.yml --profile routing up -d valhalla
```

The API reads `data-version.json` (written by the build) and reports `osmExtractDate` as
`dataVersions.routingGraph` on `/health`. Until a graph is built it reports `not-built` and the
routing dependency shows `down` (the rest of the stack still runs).
