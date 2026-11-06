/**
 * Rights registry (Phase 8). The single source of truth for what we may display, cache,
 * proxy, and store from each data source — and how it must be attributed.
 *
 * docs/RIGHTS.md is GENERATED from this file (`npm run rights:doc`); a test fails if it drifts.
 *
 * Every entry starts as "unverified". An entry may only be marked "verified" with a
 * `verifiedAt` date, the person who checked, and a link to the governing terms/contract.
 * Pilot and prod refuse to serve unverified sources (config.rights.allowUnverified=false).
 */
export type RightsStatus = 'unverified' | 'verified' | 'prohibited';

export interface RightsEntry {
  id: string;
  name: string;
  provider: string;
  dataTypes: string[];
  status: RightsStatus;
  mayDisplay: boolean;
  mayCache: boolean;
  /** Upper bound on cache lifetime allowed by the terms; null = no stated limit (config TTL applies). */
  maxCacheTtlSeconds: number | null;
  /** May we serve it through our own API (vs. the client calling the provider)? */
  mayProxy: boolean;
  /** May we store derived data (e.g. computed hazards, aggregates)? */
  mayStoreDerived: boolean;
  attribution: string | null;
  termsUrl: string | null;
  verifiedBy?: string;
  verifiedAt?: string;
  notes: string;
}

export const RIGHTS_REGISTRY_VERSION = '2026-11-06.1';

export const rightsRegistry: readonly RightsEntry[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap data (routing graph, base restrictions)',
    provider: 'OpenStreetMap contributors',
    dataTypes: ['road network', 'tagged restrictions (maxheight, maxweight, hgv)'],
    status: 'unverified',
    mayDisplay: true,
    mayCache: true,
    maxCacheTtlSeconds: null,
    mayProxy: true,
    mayStoreDerived: true,
    attribution: '© OpenStreetMap contributors',
    termsUrl: 'https://www.openstreetmap.org/copyright',
    notes:
      'ODbL 1.0. Share-alike obligations may apply to derived databases we publicly use — confirm with counsel before mixing OSM-derived restrictions with proprietary data.',
  },
  {
    id: 'maptiler',
    name: 'MapTiler vector tiles + styles',
    provider: 'MapTiler',
    dataTypes: ['base map tiles', 'styles', 'glyphs', 'sprites'],
    status: 'unverified',
    mayDisplay: true,
    // Cloud Terms §7 "Server-side Proxy & Caching": no storing / redistributing map content from a
    // server-side cache. Device caching for a single end-user IS allowed (§5).
    mayCache: false,
    maxCacheTtlSeconds: 0,
    // Cloud Terms §6: proxy use only with MapTiler's written approval (+ fees). Pilot/prod refuse to
    // boot in proxy mode until tiles.maptiler.proxyApprovalRef is set.
    mayProxy: false,
    mayStoreDerived: false,
    attribution: '© MapTiler © OpenStreetMap contributors',
    termsUrl: 'https://www.maptiler.com/terms/cloud/',
    notes:
      'Read 2026-11-06 (General Terms + Cloud Terms): attribution must be on screen while the map is shown (§5) and OSM attribution linked to openstreetmap.org/copyright; device cache allowed for one end-user (§5); proxy needs written approval (§6); bulk tile download needs written agreement (§6) — route prefetch is off until bulkDownloadAgreementRef is set; no server-side cache and no redistribution as screenshot/static image (§7) — shared views carry text + attribution only. Needs counsel / a human to confirm before marking verified.',
  },
  {
    id: 'tollsmart',
    name: 'TollSmart toll estimates',
    provider: 'TollSmart',
    dataTypes: ['toll cost estimates'],
    status: 'unverified',
    mayDisplay: true,
    mayCache: true,
    maxCacheTtlSeconds: null,
    mayProxy: true,
    mayStoreDerived: false,
    attribution: null,
    termsUrl: null,
    notes: 'Contract terms not yet reviewed. Caching window and display requirements must come from the signed agreement.',
  },
  {
    id: 'ny511',
    name: '511NY traffic events and camera feeds',
    provider: 'NYSDOT / 511NY',
    dataTypes: ['traffic events', 'construction', 'camera still images'],
    status: 'unverified',
    mayDisplay: true,
    mayCache: true,
    maxCacheTtlSeconds: null,
    mayProxy: true,
    mayStoreDerived: false,
    attribution: '511NY',
    termsUrl: null,
    notes: 'Developer terms to be reviewed: camera image re-display, caching interval, and attribution format.',
  },
  {
    id: 'google-imagery',
    name: 'Google street-level / aerial imagery (Know Before You Go previews)',
    provider: 'Google Maps Platform',
    dataTypes: ['street-level imagery', 'static map images'],
    status: 'unverified',
    mayDisplay: true,
    mayCache: false,
    maxCacheTtlSeconds: 0,
    mayProxy: false,
    mayStoreDerived: false,
    attribution: 'Google',
    termsUrl: 'https://cloud.google.com/maps-platform/terms',
    notes:
      'Defaulting to NO caching and NO proxying until terms are reviewed. Google terms historically restrict caching and use alongside non-Google maps — this may block use on a MapLibre base map entirely.',
  },
  {
    id: 'driver-contributions',
    name: 'Driver-contributed reports (wait times, entrance notes, photos)',
    provider: 'DrayVision users',
    dataTypes: ['wait-time reports', 'entrance notes', 'photos'],
    status: 'unverified',
    mayDisplay: true,
    mayCache: true,
    maxCacheTtlSeconds: null,
    mayProxy: true,
    mayStoreDerived: true,
    attribution: null,
    termsUrl: null,
    notes: 'Requires a contributor licence in our ToS before collection starts (Phase 10). Photos must be screened for faces/plates.',
  },
];

export function getRights(id: string): RightsEntry | undefined {
  return rightsRegistry.find((r) => r.id === id);
}

export interface RightsDecision {
  allowed: boolean;
  reason: string;
  /** Effective cache TTL after applying the rights ceiling; 0 = do not cache. */
  cacheTtlSeconds: number;
}

/** Combine the configured TTL with what the rights entry permits. */
export function decideUse(id: string, configuredTtlSeconds: number, allowUnverified: boolean): RightsDecision {
  const entry = getRights(id);
  if (!entry) return { allowed: false, reason: `no rights entry for "${id}"`, cacheTtlSeconds: 0 };
  if (entry.status === 'prohibited') return { allowed: false, reason: `${id} is prohibited`, cacheTtlSeconds: 0 };
  if (entry.status === 'unverified' && !allowUnverified) {
    return { allowed: false, reason: `${id} rights are unverified and this environment requires verified rights`, cacheTtlSeconds: 0 };
  }
  if (!entry.mayDisplay) return { allowed: false, reason: `${id} may not be displayed`, cacheTtlSeconds: 0 };
  const ceiling = entry.maxCacheTtlSeconds ?? Number.POSITIVE_INFINITY;
  const ttl = entry.mayCache ? Math.min(configuredTtlSeconds, ceiling) : 0;
  return { allowed: true, reason: entry.status, cacheTtlSeconds: ttl };
}
