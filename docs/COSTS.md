# DrayVision costs

This file holds **verified** vendor figures with dates. It replaces cost estimates from the
original planning chat as each figure gets verified. If a number is not verified it says so;
config uses `null` for it (`services/api/config/*.ts`, `budgets.unitCostUsd`), and the API counts
those calls without pricing them.

_Last reviewed: 2026-11-04 (scaffold: no vendor figures verified yet)._

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
| MapTiler | Vector tiles / styles (via `/tiles` proxy) | per 1k requests / plan | _unverified_ | _unverified_ | — | — | — |
| TollSmart | Toll estimates (Phase 6) | per request | _unverified_ | _unverified_ | — | — | — |
| Google Maps Platform | Imagery previews (Phase 9) | per 1k requests | _unverified_ | _unverified_ | — | — | — |
| 511NY | Traffic events + cameras (Phases 7/8) | — | _unverified_ (believed free; confirm terms) | — | — | — | — |
| Valhalla (self-hosted) | Routing compute | per month (instance size) | _unverified_ | n/a | — | — | — |
| Postgres (managed) | DB | per month | _unverified_ | — | — | — | — |
| Redis (managed) | Cache | per month | _unverified_ | — | — | — | — |
| Monitoring / logging | APM + logs | per month | _unverified_ | — | — | — | — |

## 4. How costs are controlled in code

- **Mobile never calls a metered provider.** Every metered call goes through the API's
  `meteredCall()` path: rights check → cache → budget check → provider → meter. A scaffold
  test fails if `apps/mobile/src` references a provider host or key.
- **Cache TTLs** for each provider are set in config (`cache.ttlSeconds`). The rights registry
  can lower them (`maxCacheTtlSeconds`) when the terms require it.
- **Per-device rate limits** are set in config (`rateLimits.perDevice`).
- **Budgets** are set per environment (`budgets.monthlyUsd`), with alert and hard-stop
  fractions.

## 5. Change log

| Date | Change | By |
|---|---|---|
| 2026-11-04 | Scaffold: caveat and planning range recorded; no vendor figures verified. | scaffold |
