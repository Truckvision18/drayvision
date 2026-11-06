# DrayVision data rights

<!-- GENERATED FILE — do not edit by hand. Source: services/api/src/rights/registry.ts -->
<!-- Regenerate with: npm run rights:doc -->

Registry version: `2026-11-06.1`

What we may display, cache, proxy and store from each source, and how it must be attributed.
Pilot and prod refuse to serve any source whose status is not `verified`.

| Source | Status | Display | Cache (max TTL) | Proxy | Store derived | Attribution |
|---|---|---|---|---|---|---|
| `osm` OpenStreetMap data (routing graph, base restrictions) | **unverified** | yes | yes (config TTL) | yes | yes | © OpenStreetMap contributors |
| `maptiler` MapTiler vector tiles + styles | **unverified** | yes | no | no | no | © MapTiler © OpenStreetMap contributors |
| `tollsmart` TollSmart toll estimates | **unverified** | yes | yes (config TTL) | yes | no | — |
| `ny511` 511NY traffic events and camera feeds | **unverified** | yes | yes (config TTL) | yes | no | 511NY |
| `google-imagery` Google street-level / aerial imagery (Know Before You Go previews) | **unverified** | yes | no | no | no | Google |
| `driver-contributions` Driver-contributed reports (wait times, entrance notes, photos) | **unverified** | yes | yes (config TTL) | yes | yes | — |

## Details

### OpenStreetMap data (routing graph, base restrictions) (`osm`)

- Provider: OpenStreetMap contributors
- Data: road network; tagged restrictions (maxheight, maxweight, hgv)
- Terms: https://www.openstreetmap.org/copyright
- Verified: not verified
- Notes: ODbL 1.0. Share-alike obligations may apply to derived databases we publicly use — confirm with counsel before mixing OSM-derived restrictions with proprietary data.

### MapTiler vector tiles + styles (`maptiler`)

- Provider: MapTiler
- Data: base map tiles; styles; glyphs; sprites
- Terms: https://www.maptiler.com/terms/cloud/
- Verified: not verified
- Notes: Read 2026-11-06 (General Terms + Cloud Terms): attribution must be on screen while the map is shown (§5) and OSM attribution linked to openstreetmap.org/copyright; device cache allowed for one end-user (§5); proxy needs written approval (§6); bulk tile download needs written agreement (§6) — route prefetch is off until bulkDownloadAgreementRef is set; no server-side cache and no redistribution as screenshot/static image (§7) — shared views carry text + attribution only. Needs counsel / a human to confirm before marking verified.

### TollSmart toll estimates (`tollsmart`)

- Provider: TollSmart
- Data: toll cost estimates
- Terms: not yet located
- Verified: not verified
- Notes: Contract terms not yet reviewed. Caching window and display requirements must come from the signed agreement.

### 511NY traffic events and camera feeds (`ny511`)

- Provider: NYSDOT / 511NY
- Data: traffic events; construction; camera still images
- Terms: not yet located
- Verified: not verified
- Notes: Developer terms to be reviewed: camera image re-display, caching interval, and attribution format.

### Google street-level / aerial imagery (Know Before You Go previews) (`google-imagery`)

- Provider: Google Maps Platform
- Data: street-level imagery; static map images
- Terms: https://cloud.google.com/maps-platform/terms
- Verified: not verified
- Notes: Defaulting to NO caching and NO proxying until terms are reviewed. Google terms historically restrict caching and use alongside non-Google maps — this may block use on a MapLibre base map entirely.

### Driver-contributed reports (wait times, entrance notes, photos) (`driver-contributions`)

- Provider: DrayVision users
- Data: wait-time reports; entrance notes; photos
- Terms: not yet located
- Verified: not verified
- Notes: Requires a contributor licence in our ToS before collection starts (Phase 10). Photos must be screened for faces/plates.
