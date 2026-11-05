# DrayVision

Truck-safe navigation for drayage drivers. This is a TypeScript monorepo with strict TS everywhere and tests from day one.

```
apps/mobile/          React Native (iOS + Android) + MapLibre — the driver app
services/api/         Node/TS API (Fastify) — the ONLY place metered keys live
services/routing/     Self-hosted Valhalla config + reproducible OSM tile build
packages/shared/      Shared domain types (TruckProfile, Route, Hazard, Facility, Camera, TollEstimate)
data/                 Verified restriction datasets, golden-route corpus, facility seeds
infra/                docker-compose (api + db + cache [+ routing]) and .env.example
docs/                 RIGHTS.md (generated) and COSTS.md (verified figures only)
```

## Ground rules

1. **Mobile never calls a metered provider.** It calls our API. The API does the rights check,
   cache lookup, budget check, provider call and metering, all in one path
   (`services/api/src/cache/metered.ts`). A repo test enforces this.
2. **No magic numbers in code.** Cache TTLs, rate limits, hazard thresholds, cost budgets and
   refresh intervals live in config, and each environment can override them:
   - API: `services/api/config/{default,dev,pilot,prod,test}.ts`, selected by `DRAYVISION_ENV`.
     The config is validated with zod at boot.
   - Mobile: `apps/mobile/src/config/`.
3. **Every route is safety-validated** against our verified restriction data
   (`services/api/src/safety`), independently of the routing engine. Routes that fail
   validation are never offered as navigable.
4. **Rights before display.** Each data source has an entry in the rights registry. Pilot and
   prod refuse sources that are still unverified. `docs/RIGHTS.md` is generated from the
   registry.
5. **Costs come from verified figures** (`docs/COSTS.md`), not chat estimates.

## Setup

Prerequisites: Node **≥ 20.11** for the API and shared packages (the mobile toolchain for
React Native 0.88 needs **≥ 22.11**; `.nvmrc` pins 22), Docker with Compose v2, and Xcode or
Android Studio for the app.

```bash
make setup
```

`make setup` does four things:

1. installs dependencies (npm workspaces for shared + api; `apps/mobile` is installed standalone),
2. copies `infra/.env.example` to `.env` if it's missing,
3. starts db (Postgres + PostGIS), cache (Redis) and the api in Docker and waits until they're healthy,
4. runs the **smoke test**. It **fails loudly** if a key that `DRAYVISION_ENV` requires is
   missing or blank, then checks `/health`.

On a fresh clone the smoke test (and the api container) **will fail until you set
`MAPTILER_KEY`** in `.env`. That is intended. To see what each environment requires, look at
`requiredEnv` in `services/api/config/*.ts`.

### Unit tests: no keys, no Docker

```bash
make test        # vitest (shared + api + repo scaffold) and jest (mobile)
make typecheck   # strict tsc across shared, api, tests, scripts, mobile
```

Tests run with `DRAYVISION_ENV=test`, which mocks every provider and requires no environment
variables. Mobile tests stub MapLibre and make any unmocked `fetch` fail.

### Running the app

```bash
cd apps/mobile
npm start
npm run android                                  # or:
(cd ios && bundle install && bundle exec pod install) && npm run ios
```

The app opens to an empty map on the **Plan** screen. The map style comes from
`<api>/tiles/style.json`.

## Runbook

| Task | Command |
|---|---|
| Start / stop the stack | `make up` / `make down` |
| Logs / status | `make logs` / `make ps` |
| Health + data versions | `curl localhost:8080/health` |
| Metering snapshot (calls, cache hits, spend) | `curl localhost:8080/meter` |
| Smoke test against a running stack | `make smoke` (`SMOKE_API_URL=…` to point elsewhere) |
| Apply DB migrations to `$DATABASE_URL` | `make migrate` (the local container applies them on first boot) |
| Regenerate `docs/RIGHTS.md` after a registry change | `make rights-doc` (a test fails if you forget) |
| Build routing tiles (Phase 4) | `make tiles EXTRACT=services/routing/extracts/<region>-<YYYY-MM-DD>.osm.pbf SHA=<sha256>` |
| Start Valhalla once tiles exist | `make up-routing` |
| Real-engine routing tests (synthetic network) | `make routing-deps` once (in a venv), then `make routing-it` |
| Run the API outside Docker | `npm run dev:api` (uses `.env` values in your shell) |

### `/health`

`/health` returns `status`, `version`, `gitSha`, `environment`, and
`dataVersions.{routingGraph, restrictions, facilities, rightsRegistry}`. It also returns
`dependencies.{db, cache, routing}`.

- `routingGraph` is the OSM extract date recorded by `build-tiles.sh`, or `not-built`.
- Until Phase 4 builds a graph, `routing` reports `down` and the status is `degraded`. db and
  cache should be `up`.

### API routes

`/health`, `/meter`, `POST /route`, `POST /tolls`, `/traffic?bbox=`, `/cameras?bbox=`,
`/cameras/:id/image`, `/imagery/preview`, `/facilities[?bbox=]`, `/facilities/:id`, `/ports`,
`/sponsored[?bbox=]`, `/tiles/style.json`, `/tiles/proxy/*`.

Live tolls, 511NY and Google imagery are shells for now: they check their keys at boot and
return `501` until their phase lands. MapTiler (tiles) and Valhalla (routing) are wired.

`POST /route` returns `{ routes, rejected }`. `routes` holds only routes that passed safety
validation, each stamped with the routing graph version (the OSM extract date) and the
restrictions version. It returns **422** when no truck-legal route exists and **502** when the
routing engine is unreachable.

## Phase 4: routing and turn-by-turn

- **Engine:** self-hosted Valhalla 3.9.1 with reproducible, dated tile builds, either through
  Docker or through local `pyvalhalla` (see `services/routing/README.md`). Truck preferences are
  set in config (`routing.truckCosting`, `routing.alternates`).
- **Proof:** `make routing-it` runs a real Valhalla on a synthetic network with a low bridge, a
  no-trucks road and a weight limit. It checks that the engine and our API route around each one.
- **App:**
  - Long-press the map to set a destination. The app gets truck-safe routes from the API,
    starting from the current GPS fix.
  - Pick a route and press Start. Turn-by-turn shows a maneuver banner, the distance to the
    turn, and the remaining time and distance.
  - If the driver stays off route long enough, the app reroutes from where they are.
  - The trip ends with an arrival screen.
- **Tuning:** thresholds (off-route distance and confirm time, arrival radius, announcement
  distances, GPS accuracy cut-off, reroute rate limit) live in `apps/mobile/src/config`.
- **Shared code:** snapping GPS to the route uses the same geometry code
  (`packages/shared/src/geometry.ts`) that the API uses to match restrictions to a route.
- **Not in Phase 4 yet:**
  - Address search: it needs a geocoder, which is a metered provider we haven't chosen.
  - Spoken voice: announcements are produced and shown on screen, and a text-to-speech engine
    plugs into `NavProvider`'s `announce`.
  - Editing the truck profile: the Settings screen shows the default rig.

### Environments

| `DRAYVISION_ENV` | Providers | Rights | Monthly budget guard rail |
|---|---|---|---|
| `test` | all mocked | unverified allowed | none |
| `dev` | MapTiler + Valhalla; rest mocked | unverified allowed | $50 |
| `pilot` | all live | **verified only** | $2,500 (top of the preliminary planning range; see COSTS.md) |
| `prod` | all live | **verified only** | set from Phase 13 actuals before scaling |

## Known scaffold limits

- Valhalla runs only under the `routing` profile, because it needs built tiles first.
- `data/restrictions`, `data/facilities` and `data/test-routes` ship **empty on purpose**. No
  unverified safety data goes in.
- Metering is in memory for now. Phase 13 persists it to the `metered_calls` table.

## Phase 14 gate checklist

_Placeholder: the full Phase 14 gate checklist gets copied in here at Phase 14. Until then, the
gate needs at least the following:_

- [ ] Golden-route corpus (`data/test-routes`) populated and 100 % passing against the live router
- [ ] Every rights registry entry in use is `verified` (pilot/prod refuse others)
- [ ] `docs/COSTS.md` planning range replaced by Phase 13 metered actuals
- [ ] Restriction dataset version stamped on every route and visible in `/health`
