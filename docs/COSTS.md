# DrayVision costs

This file holds **verified** vendor figures with dates. It replaces cost estimates from the
original planning chat as each figure gets verified. If a number is not verified it says so;
config uses `null` for it (`services/api/config/*.ts`, `budgets.unitCostUsd`), and the API counts
those calls without pricing them.

_Last reviewed: 2026-11-06. MapTiler figures verified from MapTiler's public pages (see §3a); all other vendors still unverified._

## 1. Caveat on the planning-chat comparison (read first)

The planning chat compared two figures as if they were alternatives:

- a **metered commercial navigation SDK** at about **thousands of dollars per month** for
  1,000 drivers × 40 trips, and
- a **small tile-only figure** for a map-tile provider.

**These are different components, not equivalent full navigation packages.** A commercial
navigation SDK bundles routing, turn-by-turn guidance, traffic, map display and often
rerouting. A tile-only plan covers **map display only**. To match the SDK, the tile-only
approach still needs routing (self-hosted Valhalla: compute + storage + ops time), truck
restriction data and validation, traffic and incident feeds, tolls, imagery, hosting,
monitoring and on-call. Don't quote the gap between the two figures as "savings" anywhere.

## 2. Pilot budget: a planning allowance, not a quote

Budget the pilot as **one combined allowance** for mapping + hosting + data + monitoring:

| Item | Figure | Status |
|---|---|---|
| Combined pilot allowance (mapping + hosting + data + monitoring) | **$500–$2,500 / month** | Preliminary planning range from the source chat. **Not verified.** |

- `config/pilot.ts` sets `budgets.monthlyUsd.total = 2500` (the top of the range) as a
  **guard rail**. The API alerts at `alertAtFraction` and stops metered calls (it serves
  from cache only) at `hardStopAtFraction`.
- **Before scaling past the pilot, replace this range with metered actuals from Phase 13**
  (the `metered_calls` table and the `/meter` endpoint), plus the hosting and monitoring
  invoices.

## 3. Vendor figures (to be verified)

Fill each row from the vendor's current pricing page or signed contract. Record the date and
a link. Then set the matching `budgets.unitCostUsd.<provider>` in config.

| Provider | Component | Unit | Unit cost (USD) | Free tier | Source / contract | Verified on | Verified by |
|---|---|---|---|---|---|---|---|
| MapTiler (Flex) | Vector tiles / styles (via `/tiles` proxy) | per 1k API requests (request-billed: see §3a) | **$0.15 / 1k** extra requests; plan **$30 / month** | **500k requests + 25k sessions / month** on Flex (Free plan: non-commercial only) | maptiler.com/cloud/pricing | 2026-11-06 | read from the public page — confirm on the account's own plan page |
| TollSmart | Toll estimates (Phase 6) | per request | _unverified_ | _unverified_ | — | — | — |
| Google Maps Platform | Imagery previews (Phase 9) | per 1k requests | _unverified_ | _unverified_ | — | — | — |
| 511NY | Traffic events + cameras (Phases 7/8) | — | _unverified_ (believed free; confirm terms) | — | — | — | — |
| Valhalla (self-hosted) | Routing compute | per month (instance size) | _unverified_ | n/a | — | — | — |
| Postgres (managed) | DB | per month | _unverified_ | — | — | — | — |
| Redis (managed) | Cache | per month | _unverified_ | — | — | — | — |
| Monitoring / logging | APM + logs | per month | _unverified_ | — | — | — | — |

## 3a. MapTiler: what we're billed for, and how we count it

The planning chat said to start on a low-cost commercial "Flex" tier and re-verify before
relying on it. Re-verified **2026-11-06** from MapTiler's public pages (fetched and read; links below):

| Fact | Value | Source |
|---|---|---|
| Current plan name / price | **Flex — $30 / month (USD)**, commercial use allowed; extra traffic billed monthly; a spending limit can be set | [pricing](https://www.maptiler.com/cloud/pricing/), [controlling expenses](https://docs.maptiler.com/guides/account/controlling-expenses/) |
| Included on Flex | 25k map sessions / month, **500k API requests / month** (also 3k search sessions, 10k 3D sessions) | pricing |
| Overage on Flex | $2.50 / 1k map sessions, **$0.15 / 1k API requests** | pricing |
| Free plan | 5k sessions, 100k requests; "testing, PoC, prototyping, personal, or non-commercial use"; MapTiler logo required — **not usable for the pilot** | pricing |
| Session definition | Starts when a user opens a page with the map; ends on reload, after 6 h, or at 10,000 requests | [sessions vs requests](https://docs.maptiler.com/guides/maps-apis/maps-platform/tile-requests-and-map-sessions-compared) |
| **Which billing unit applies to us** | Sessions exist only for MapTiler SDK JS / Leaflet plugin. "If you built your map app using MapTiler API combined with 3rd party clients and libraries, then the traffic is tracked by request. Switching to sessions is not technically possible." MapLibre React Native (and our proxy) → **request-billed** | sessions vs requests |
| Request weights | Vector tile 1; 512 px raster 4; 256 px raster 1; static map image 15; **TileJSON, style JSON, fonts: free**. Sprites aren't listed — we count them as 1 (conservative) | sessions vs requests |

**So the cost driver is vector-tile requests that reach MapTiler.** The proxy counts every
upstream request per kind and weights it with `tiles.maptiler.requestWeights`; `/usage/maps`
reports `billable_requests` per day and per device, and an estimated cost at the overage rate
(an upper bound — it ignores the 500k included requests). The monthly Meter applies
`budgets.monthlyUsd.tiles` with the same unit price and stops calling MapTiler at the hard stop.

Terms that shape the design (MapTiler [General](https://www.maptiler.com/terms/) + [Cloud](https://www.maptiler.com/terms/cloud/) terms, read 2026-11-06):

- **Proxy (§6):** "individual end-users must generate direct requests directly to MapTiler
  infrastructure … Upon request, with MapTiler's approval and additional fees incurred, the
  Service may be used via a Customers' proxy server." → Default mode is proxy *pending
  approval*; pilot/prod refuse to boot in proxy mode until `MAPTILER_PROXY_APPROVAL_REF` is set.
  **Action: request proxy approval from MapTiler and record any proxy fee here.** The fee may
  change the comparison with `TILE_DELIVERY=direct` (allowed today, but then MapTiler's dashboard is
  the only per-request count) or `TILE_SOURCE=self-hosted`.
- **Server-side caching (§7) is prohibited** → MapTiler responses are never cached by our API.
  **Device caching (§5) is allowed** ("temporary personal cache … for use by a single end-user")
  → we send `Cache-Control: private` and size the on-device ambient cache from config.
- **Bulk downloading (§6) needs a written agreement** → route-corridor prefetch is off for
  MapTiler until `tiles.maptiler.bulkDownloadAgreementRef` is set (it's on for self-hosted tiles).
- **No redistribution as screenshot / static image (§7)** → shared views are text + attribution
  for MapTiler; a map image is only attached for self-hosted (OSM) tiles.

### Test day: reconcile with the MapTiler dashboard

1. Run the pilot build for one full **UTC** day with `TILE_SOURCE=maptiler`, `TILE_DELIVERY=proxy`,
   using a MapTiler key that **only the proxy uses** (other apps on the key break the comparison).
2. Drivers / testers can watch their own counts in the app (Trucks → *Map usage (debug)*).
3. Next day: read that day's request total from MapTiler's Analytics page, then
   `npx tsx scripts/reconcile-map-usage.ts --day YYYY-MM-DD --dashboard <requests>`.
   It compares with our `billable_requests` and fails outside `tiles.reconcileTolerance` (±2 %).
4. Record the result in the change log below. If MapTiler's day isn't UTC, align the window
   first (to verify on the day). If sprites turn out to be free, set their weight to 0.

The ±2 % tolerance covers day-boundary skew and in-flight requests. It is a starting value, to
be revised from the first test day.

## 4. How costs are controlled in code

- **Mobile never calls a metered provider.** Every metered call goes through the API's
  `meteredCall()` path: rights check → cache → budget check → provider → meter. A scaffold
  test fails if `apps/mobile/src` references a provider host or key.
- **Cache TTLs** for each provider are set in config (`cache.ttlSeconds`). The rights registry
  can lower them (`maxCacheTtlSeconds`) when the terms require it.
- **Per-device rate limits** are set in config (`rateLimits.perDevice`).
- **Budgets** are set per environment (`budgets.monthlyUsd`), with alert and hard-stop
  fractions.
- **Map tiles**: request-weighted metering per device per day (`/usage/maps`), no
  server-side cache for MapTiler, private device cache, corridor-only prefetch (when allowed),
  budget hard stop, and a config flag (`TILE_SOURCE` / `TILE_DELIVERY`) to move to self-hosted
  tiles without an app release.

## 5. Change log

| Date | Change | By |
|---|---|---|
| 2026-11-04 | Scaffold: caveat and planning range recorded; no vendor figures verified. | scaffold |
| 2026-11-06 | MapTiler plan, session definition, request weights, overage and terms verified from public pages; pilot tile budget now priced at $0.15/1k billable requests. | build |
