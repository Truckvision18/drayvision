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

`/health` returns `status`, `version`, `git_sha`, `environment`, and
`data_versions.{routing_graph, restrictions, facilities, rights_registry}`. It also returns
`dependencies.{db, cache, routing}`.

- `routing_graph` is the OSM extract date recorded by `build-tiles.sh`, or `not-built`.
- Until Phase 4 builds a graph, `routing` reports `down` and the status is `degraded`. db and
  cache should be `up`.

### API routes

Public: `/health`, `/meter`, `/traffic?bbox=`, `/cameras?bbox=`, `/cameras/:id/image`,
`/imagery/preview`, `/facilities[?bbox=]`, `/facilities/:id`, `/ports`, `/sponsored[?bbox=]`,
`/tiles/style.json`, `/tiles/proxy/*`.

Per account (see [Truck profiles](#truck-profiles)): `/profiles…`, `POST /route`,
`POST /tolls`, `GET /tolls/:id`, `POST /safety/validate`.

Every request and response body is defined once in `packages/shared` as a zod schema, and the
TypeScript types are derived from it. Every error is `{ error: CODE, message }` (`ApiErrorSchema`).
`services/api/test/contract.test.ts` calls every endpoint and validates each payload against
its shared schema.

Live tolls, 511NY and Google imagery are shells for now: they check their keys at boot and
return `501` until their phase lands. MapTiler (tiles) and Valhalla (routing) are wired.

`POST /route` takes a `RouteRequest`: `origin`, either `destination_facility_id` or
`destination_coords`, `truck_profile_id` and `departure_time`. A facility destination is
routed to its **primary truck entrance**. A facility with no entrance on file is refused rather
than routed to its street address. The response is `{ routes, rejected }`:
- `routes` holds only routes that passed safety validation.
- Each route records `data_versions`: graph, restrictions, rights registry, and the exact
  `truck_profile_id` and `truck_profile_version` it was computed for.

Errors: **422** `PROFILE_INCOMPLETE` (with `missing_fields`), `NO_ROUTE` or
`FACILITY_NO_TRUCK_ENTRANCE`, and **502** when the routing engine is unreachable.

## Map and tiles

**One map, everywhere.** `apps/mobile/src/map/MapView.tsx` (MapLibre React Native) is the only
map in the app: plan, navigate and facility views all use it. A repo test fails if another map
SDK is added, or if anything outside `src/map/` imports the SDK.

**Layers, bottom to top:**
- base roads
- route
- truck restrictions / hazards
- traffic incidents
- cameras (parked only)
- facilities and truck entrances
- sponsored pins (purple, labelled "Sponsored")

Every layer is always mounted in that order, and toggles only change visibility. The API also
appends `dv-anchor-*` layers to the style, and each overlay is pinned below the next anchor.
Drivers switch layers from the **Layers** button. Camera images only show while parked, and
camera data isn't even fetched while moving.

**Attribution** ("© MapTiler", "© OpenStreetMap contributors", each linking to its copyright
page) is drawn by the app on top of every map at all times. It is included in every shared
route. With MapTiler, a share is text only: its terms forbid redistributing map images. A UI
test fails if any map instance lacks attribution.

**Tile source is a server config flag, not an app setting.** The app reads `GET /tiles/config`
at launch and on every foreground. The response carries the style URL, attribution, billing
unit, device-cache size, and prefetch and export policy.

| Env var | Values | Effect |
|---|---|---|
| `TILE_SOURCE` | `maptiler` (default) · `self-hosted` · `mock` | which tiles every app uses — flip and restart the API, no app release |
| `TILE_DELIVERY` | `proxy` (default) · `direct` | MapTiler through our API (needs MapTiler's written approval in pilot/prod: `MAPTILER_PROXY_APPROVAL_REF`), or straight from MapTiler with a restricted `MAPTILER_CLIENT_KEY` |
| `SELF_HOSTED_TILES_URL` | URL | our own tile server (the exit ramp if hosted-tile costs grow) |

Tile URLs are namespaced per source (`/tiles/<source>/…`), so device caches never mix sources,
and an old source's URLs answer `410 TILE_SOURCE_CHANGED`.

**Cost controls.** MapTiler bills this integration **per request**: map sessions exist only
for MapTiler's JS SDK. A vector tile counts 1, while style, TileJSON and fonts are free. Details
and verified figures are in `docs/COSTS.md` §3a.
- **Counting:** the proxy counts every upstream request by kind, per device per day.
  `GET /usage/maps/me` feeds the in-app debug panel (Trucks → *Map usage (debug)*), and
  `GET /usage/maps` gives all devices (ops token outside dev).
- **Sessions:** the app reports each map session (plan / navigate / facility) for
  per-user-per-day analytics.
- **Reconciliation:** `scripts/reconcile-map-usage.ts` checks a test day against the MapTiler
  dashboard (±2 %).
- **Caching:**
  - Our API never caches MapTiler content (its terms forbid it); our own tiles may be cached.
  - Devices keep a private, on-device ambient cache for the working area (size from config).
  - Prefetch covers only the active route corridor plus the destination area, and is off for
    MapTiler unless a bulk-download agreement is configured.

## Truck profiles

Everything downstream (routing, tolls, safety, ports) keys off the truck profile.

- **Several per account:** different tractors or loads, up to `profiles.maxPerAccount`.
- **Stored server-side:** Postgres `truck_profiles`, plus an immutable `truck_profile_versions`
  history. The app caches profiles on the device.
- **Fields:** height, weight, length, width, axle count, and a hazmat flag with classes. Also the
  toll transponders held (network only, never the tag number), an optional home terminal,
  `is_default`, and created/updated timestamps. All measurements are SI; the app shows
  feet/inches and pounds.
- **Exactly one default** per account. The first profile becomes the default, and deleting the
  default promotes another.

**No route, toll or safety call runs without a complete profile.** A profile can be *saved*
with blanks (`null`), but every profile-dependent endpoint answers
`422 PROFILE_INCOMPLETE` — "Complete your truck profile: add height and weight…" — until
height, weight, length, width, axles and the hazmat answer are all present. There is no
fallback rig, inline dimensions are refused, and the mobile app no longer has a default
profile. Plausibility bounds (`PROFILE_BOUNDS` in `packages/shared`) catch unit mistakes, such
as inches typed into a metres field.

**Versioning:**
- Every real edit bumps `version`. A no-op save doesn't, and neither does changing the default flag.
- `PATCH` must send `expected_version`. A stale edit from another device gets
  `409 VERSION_CONFLICT`; it never silently overwrites.
- Routes and toll estimates record the profile version, and every cache key includes it, on the
  server (Redis) and on the device. So an edit can't serve a route computed for the old truck.
  The app purges those cached routes on the spot and replans any route it's showing.
- `GET /profiles/:id/versions/:v` returns the exact snapshot a route used, even after the profile is deleted.

| Endpoint | |
|---|---|
| `GET /profiles` | the account's profiles, default first |
| `POST /profiles` | create (may be incomplete) → 201 |
| `GET /profiles/:id` | current version |
| `PATCH /profiles/:id` | edit; body needs `expected_version` |
| `POST /profiles/:id/default` | make default |
| `DELETE /profiles/:id` | soft delete → 204 (history kept) |
| `GET /profiles/:id/versions/:version` | historical snapshot |

**Accounts:** real sign-in isn't built yet.
- In `dev` and `test`, the account comes from an `x-account-id` header (`auth.mode: dev-header`).
- In `pilot` and `prod`, `auth.mode: token` fails closed: account endpoints return `501` until
  sign-in exists. They never trust that header.

**Database:** existing local databases need migration 002 (`make migrate`). New ones get it
automatically. `make test-pg` runs the profile-store behaviour suite against Postgres,
including concurrent edits from two devices.

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
  - (Truck profile editing landed with the profiles work — see [Truck profiles](#truck-profiles).)

### Environments

| `DRAYVISION_ENV` | Providers | Rights | Monthly budget guard rail |
|---|---|---|---|
| `test` | all mocked | unverified allowed | none |
| `dev` | MapTiler + Valhalla; rest mocked | unverified allowed | $50 |
| `pilot` | all live | **verified only** | $2,500 (top of the preliminary planning range; see COSTS.md) |
| `prod` | all live | **verified only** | set from Phase 13 actuals before scaling |

## Known scaffold limits

- Valhalla runs only under the `routing` profile, because it needs built tiles first.
- MapTiler proxy use needs MapTiler's written approval before pilot (see `docs/COSTS.md` §3a).
  Until then, pilot/prod must use `TILE_DELIVERY=direct` or `TILE_SOURCE=self-hosted`.
- Account sign-in isn't built: profiles use a dev-only `x-account-id` header, and pilot/prod
  answer `501` for account endpoints until it is.
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
