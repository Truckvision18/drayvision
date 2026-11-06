import { z } from 'zod';

/**
 * Every tunable number in DrayVision lives here — cache TTLs, rate limits, hazard
 * thresholds, cost budgets, refresh intervals. Code reads `AppConfig`; it never
 * hard-codes these values. Per-environment overrides live in `<env>.ts`.
 *
 * `null` for a cost means "not yet verified" — see docs/COSTS.md. Do not invent figures.
 */
const seconds = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();
const usd = z.number().nonnegative().nullable();

export const ENVIRONMENTS = ['dev', 'pilot', 'prod', 'test'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const SECRET_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'VALHALLA_URL',
  'MAPTILER_KEY',
  /** Restricted, client-safe MapTiler key — only used when tiles.delivery = direct. */
  'MAPTILER_CLIENT_KEY',
  /** Base URL of our own tile server (tiles.source = self-hosted). */
  'SELF_HOSTED_TILES_URL',
  /** Guards the all-devices usage endpoint outside dev/test. */
  'OPS_TOKEN',
  'TOLLSMART_API_KEY',
  'TOLLSMART_BASE_URL',
  'GOOGLE_MAPS_API_KEY',
  'NY511_API_KEY',
] as const;
export type SecretEnvVar = (typeof SECRET_ENV_VARS)[number];

const meteredProviders = ['tolls', 'traffic', 'cameras', 'imagery', 'tiles', 'feeds511'] as const;
export type MeteredProvider = (typeof meteredProviders)[number];
const perProvider = <T extends z.ZodTypeAny>(t: T) =>
  z.object(Object.fromEntries(meteredProviders.map((p) => [p, t])) as Record<MeteredProvider, T>);

export const configSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  server: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    bodyLimitBytes: positiveInt,
    requestTimeoutMs: positiveInt,
    /** Public base URL the mobile app reaches the API on — used to rewrite proxied tile URLs. */
    publicBaseUrl: z.string().url(),
  }),
  providers: z.object({
    routing: z.enum(['mock', 'valhalla']),
    tolls: z.enum(['mock', 'tollsmart']),
    traffic: z.enum(['mock', 'ny511']),
    cameras: z.enum(['mock', 'ny511']),
    imagery: z.enum(['mock', 'google']),
  }),
  /** Env vars that must be non-empty for this environment; checked at startup and by `make smoke`. */
  requiredEnv: z.array(z.enum(SECRET_ENV_VARS)),
  cache: z.object({
    backend: z.enum(['memory', 'redis']),
    ttlSeconds: perProvider(seconds).extend({ facilities: seconds, route: seconds }),
    memoryMaxEntries: positiveInt,
    keyPrefix: z.string(),
  }),
  rateLimits: z.object({
    windowSeconds: positiveInt,
    /** Requests per device (x-device-id header, falling back to IP) per window, per route group. */
    perDevice: z.object({
      route: positiveInt,
      tolls: positiveInt,
      traffic: positiveInt,
      cameras: positiveInt,
      facilities: positiveInt,
      tiles: positiveInt,
      default: positiveInt,
    }),
  }),
  budgets: z.object({
    /** Monthly spend ceilings in USD. Pilot figure is a planning allowance, NOT a quote — see docs/COSTS.md. */
    monthlyUsd: perProvider(usd).extend({ total: usd }),
    /** Unit cost per metered call in USD; null = unverified, calls are counted but not priced. */
    unitCostUsd: perProvider(usd),
    alertAtFraction: z.number().min(0).max(1),
    /** At this fraction of budget, metered calls are refused and cache-only responses served. */
    hardStopAtFraction: z.number().min(0).max(2),
  }),
  safety: z.object({
    /** Extra vertical clearance demanded above the rig's declared height (metres). */
    clearanceMarginM: z.number().nonnegative(),
    /** Extra weight margin applied to gross weight before comparing to posted limits (kg). */
    weightMarginKg: z.number().nonnegative(),
    /** Distance from route geometry within which a restriction is considered "on route" (metres). */
    hazardMatchRadiusM: z.number().positive(),
    /** If true, routes that fail validation are never returned as navigable. */
    blockOnFail: z.boolean(),
    /** Clearance within this many metres of rig height is a warning, not a pass. */
    clearanceWarnBandM: z.number().nonnegative(),
    /** Below this confidence a restriction can still FAIL a route, but can never clear it (→ warning). */
    minConfidenceToClear: z.number().min(0).max(1),
  }),
  refresh: z.object({
    feeds511Seconds: positiveInt,
    camerasSeconds: positiveInt,
    facilitiesSeconds: positiveInt,
    waitTimesSeconds: positiveInt,
  }),
  routing: z.object({
    timeoutMs: positiveInt,
    defaultValhallaUrl: z.string().url(),
    /** Departure times within the same bucket share cached routes. */
    departureBucketSeconds: positiveInt,
    /** Extra alternative routes to request (each is safety-validated independently). */
    alternates: z.number().int().min(0).max(3),
    /** Valhalla truck costing preferences, 0 (avoid) .. 1 (prefer). Hard limits come from the TruckProfile. */
    truckCosting: z.object({
      useHighways: z.number().min(0).max(1),
      useTolls: z.number().min(0).max(1),
      useLivingStreets: z.number().min(0).max(1),
      useTracks: z.number().min(0).max(1),
      /** km/h cap applied to ETA calculations; null = engine default. */
      topSpeedKph: z.number().positive().nullable(),
    }),
  }),
  /**
   * Base map tiles. `source` and `delivery` can be flipped per deployment (TILE_SOURCE /
   * TILE_DELIVERY env vars) without a code change or an app release: the app reads
   * GET /tiles/config at launch.
   */
  tiles: z.object({
    source: z.enum(['maptiler', 'self-hosted', 'mock']),
    delivery: z.enum(['proxy', 'direct']),
    maptiler: z.object({
      baseUrl: z.string().url(),
      styleId: z.string().min(1),
      /**
       * MapTiler Cloud Terms §6: proxying needs MapTiler's written approval. Pilot/prod refuse to
       * start in proxy mode until this holds the approval reference (e.g. ticket / contract id).
       */
      proxyApprovalRef: z.string().min(1).nullable(),
      /** Cloud Terms §6: bulk tile download (route prefetch) needs a written agreement. */
      bulkDownloadAgreementRef: z.string().min(1).nullable(),
      /**
       * How MapTiler counts one request of each kind for request-billed integrations
       * (docs "Map usage: Sessions vs requests", read 2026-11-06). Kinds the table doesn't list
       * (sprites, other) are counted as 1 to stay conservative.
       */
      requestWeights: z.object({
        vector_tile: z.number().nonnegative(),
        raster_tile_512: z.number().nonnegative(),
        raster_tile_256: z.number().nonnegative(),
        style: z.number().nonnegative(),
        tilejson: z.number().nonnegative(),
        font: z.number().nonnegative(),
        sprite: z.number().nonnegative(),
        other: z.number().nonnegative(),
      }),
    }),
    selfHosted: z.object({
      /** Path of the style document on the self-hosted tile server. */
      stylePath: z.string().min(1),
      /** Our own OSM-derived tiles may be cached server-side (ODbL; see rights registry `osm`). */
      serverCacheTtlSeconds: z.number().int().nonnegative(),
    }),
    deviceCache: z.object({
      /** On-device ambient tile cache (single-user cache — allowed by MapTiler Cloud Terms §5). */
      ambientCacheBytes: positiveInt,
      /** Cache-Control max-age (private) we send for tiles, fonts and sprites. */
      tileMaxAgeSeconds: z.number().int().nonnegative(),
      styleMaxAgeSeconds: z.number().int().nonnegative(),
    }),
    prefetch: z.object({
      corridorBufferM: z.number().positive(),
      corridorChunkM: z.number().positive(),
      destinationRadiusM: z.number().positive(),
      minZoom: z.number().int().min(0).max(22),
      maxZoom: z.number().int().min(0).max(22),
      maxTilesPerPack: positiveInt,
      maxPacks: positiveInt,
    }),
    /** Test day: our billable-request count must be within this fraction of the provider dashboard. */
    reconcileTolerance: z.number().min(0).max(1),
    /** Our map-session definition (mirrors MapTiler's: ends after 6 h or 10,000 requests). */
    session: z.object({ maxDurationSeconds: positiveInt, maxRequests: positiveInt }),
  }),
  analytics: z.object({
    /** Usage counters are buffered in memory and written to Postgres this often. */
    flushIntervalSeconds: positiveInt,
  }),
  /** How requests are tied to an account (profiles are stored per account). */
  auth: z.object({
    /**
     * dev-header: trust an `x-account-id` header — local dev and tests ONLY.
     * token: real sign-in (not built yet) — every account-scoped call answers 501 until it is.
     */
    mode: z.enum(['dev-header', 'token']),
  }),
  profiles: z.object({
    /** Saved truck profiles per account (several tractors / loads). */
    maxPerAccount: positiveInt,
  }),
  rights: z.object({
    /** Allow sources whose rights entry is still "unverified". Must be false in pilot/prod. */
    allowUnverified: z.boolean(),
  }),
  paths: z.object({
    /** Relative to repo root unless absolute. */
    dataDir: z.string(),
    routingDataVersionFile: z.string(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

export type DeepPartial<T> = T extends readonly (infer _U)[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
