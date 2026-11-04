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
    tiles: 'maptiler',
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
      tiles: null,
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
  },
  rights: {
    allowUnverified: true,
  },
  paths: {
    dataDir: 'data',
    routingDataVersionFile: 'services/routing/data-version.json',
  },
};
