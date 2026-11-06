import type { AppConfig } from './types.js';

/**
 * Baseline values shared by every environment. Override per-environment in dev.ts / pilot.ts /
 * prod.ts / test.ts. Values are starting points for the pilot, not tuned figures — every change
 * after Phase 13 should cite metered actuals.
 */
export const defaults: Omit<AppConfig, 'environment'> = {
  server: {
    host: '0.0.0.0',
    port: 8080,
    bodyLimitBytes: 1_048_576,
    requestTimeoutMs: 15_000,
    publicBaseUrl: 'http://localhost:8080',
  },
  providers: {
    routing: 'valhalla',
    tolls: 'mock',
    traffic: 'mock',
    cameras: 'mock',
    imagery: 'mock',
  },
  requiredEnv: ['DATABASE_URL', 'REDIS_URL'],
  cache: {
    backend: 'redis',
    ttlSeconds: {
      tolls: 86_400, // tolls change rarely; one metered call per route-shape per day
      traffic: 120,
      cameras: 60,
      imagery: 2_592_000,
      tiles: 604_800,
      feeds511: 300,
      facilities: 3_600,
      route: 300,
    },
    memoryMaxEntries: 10_000,
    keyPrefix: 'dv:',
  },
  rateLimits: {
    windowSeconds: 60,
    perDevice: {
      route: 20,
      tolls: 10,
      traffic: 60,
      cameras: 60,
      facilities: 60,
      tiles: 1_200,
      default: 120,
    },
  },
  budgets: {
    monthlyUsd: {
      total: null,
      tolls: null,
      traffic: null,
      cameras: null,
      imagery: null,
      tiles: null,
      feeds511: null,
    },
    unitCostUsd: {
      tolls: null,
      traffic: null,
      cameras: null,
      imagery: null,
      // MapTiler Flex: $0.15 per 1,000 extra API requests (maptiler.com/cloud/pricing, read 2026-11-06).
      // Per *billable* request. Ignores the 500k included requests → an upper-bound estimate.
      tiles: 0.15 / 1000,
      feeds511: null,
    },
    alertAtFraction: 0.8,
    hardStopAtFraction: 1.0,
  },
  safety: {
    clearanceMarginM: 0.15,
    weightMarginKg: 0,
    hazardMatchRadiusM: 25,
    blockOnFail: true,
    clearanceWarnBandM: 0.3,
    minConfidenceToClear: 0.8,
  },
  refresh: {
    feeds511Seconds: 300,
    camerasSeconds: 60,
    facilitiesSeconds: 86_400,
    waitTimesSeconds: 300,
  },
  routing: {
    timeoutMs: 10_000,
    defaultValhallaUrl: 'http://localhost:8002',
    departureBucketSeconds: 900,
    alternates: 2,
    truckCosting: {
      useHighways: 1.0, // drayage: prefer highways over local streets
      useTolls: 0.5, // neutral until per-trip toll preference lands
      useLivingStreets: 0.0, // avoid residential "living streets"
      useTracks: 0.0, // never route a container rig onto tracks
      topSpeedKph: 100, // ~62 mph — realistic loaded-rig ETA
    },
  },
  tiles: {
    source: 'maptiler',
    delivery: 'proxy',
    maptiler: {
      baseUrl: 'https://api.maptiler.com/',
      styleId: 'streets-v2',
      proxyApprovalRef: null,
      bulkDownloadAgreementRef: null,
      requestWeights: {
        vector_tile: 1,
        raster_tile_512: 4,
        raster_tile_256: 1,
        style: 0, // "TileJSONs, Style JSONs, Fonts … Free"
        tilejson: 0,
        font: 0,
        sprite: 1, // not listed by MapTiler — counted conservatively
        other: 1,
      },
    },
    selfHosted: {
      stylePath: 'styles/drayvision/style.json',
      serverCacheTtlSeconds: 86_400,
    },
    deviceCache: {
      ambientCacheBytes: 256 * 1024 * 1024, // working-area cache: a few metro areas at street zooms
      tileMaxAgeSeconds: 7 * 86_400,
      styleMaxAgeSeconds: 3_600,
    },
    prefetch: {
      corridorBufferM: 500,
      // A rectangular pack's corner can sit up to chunk/2 + √2·buffer off the route (diagonal worst
      // case): 1 km chunks + 500 m buffer → ≤ ~1.2 km. Shorter chunks hug tighter but need more packs.
      corridorChunkM: 1_000,
      destinationRadiusM: 1_500,
      minZoom: 10,
      maxZoom: 16,
      maxTilesPerPack: 2_000,
      maxPacks: 80, // 1 km chunks → covers an ~80 km drayage leg (+ destination)
    },
    reconcileTolerance: 0.02, // ±2 %: clock skew at the day boundary + in-flight requests
    session: { maxDurationSeconds: 6 * 3_600, maxRequests: 10_000 },
  },
  analytics: {
    flushIntervalSeconds: 30,
  },
  auth: {
    mode: 'dev-header',
  },
  profiles: {
    maxPerAccount: 20,
  },
  rights: {
    allowUnverified: true,
  },
  paths: {
    dataDir: 'data',
    routingDataVersionFile: 'services/routing/data-version.json',
  },
};
