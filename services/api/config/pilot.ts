import type { AppConfig, DeepPartial } from './types.js';

/**
 * Pilot. The total budget is the TOP of the preliminary planning range ($500–$2,500/month
 * combined mapping + hosting + data + monitoring) from docs/COSTS.md. It is a guard rail, not a
 * quote; replace with metered actuals from Phase 13 before scaling.
 */
export const pilot: DeepPartial<AppConfig> = {
  providers: {
    tolls: 'tollsmart',
    traffic: 'ny511',
    cameras: 'ny511',
    imagery: 'google',
  },
  requiredEnv: [
    'DATABASE_URL',
    'REDIS_URL',
    'VALHALLA_URL',
    'MAPTILER_KEY',
    'TOLLSMART_API_KEY',
    'TOLLSMART_BASE_URL',
    'GOOGLE_MAPS_API_KEY',
    'NY511_API_KEY',
  ],
  budgets: {
    monthlyUsd: { total: 2_500 },
  },
  rights: { allowUnverified: false },
  // Never trust a client-supplied account id outside dev/test.
  auth: { mode: 'token' },
};
