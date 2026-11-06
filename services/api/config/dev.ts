import type { AppConfig, DeepPartial } from './types.js';

export const dev: DeepPartial<AppConfig> = {
  // Tile keys are required according to tiles.source / tiles.delivery (see missingRequiredEnv).
  requiredEnv: ['DATABASE_URL', 'REDIS_URL'],
  budgets: {
    // Developer sandbox ceiling — keeps accidental loops from running up a bill.
    monthlyUsd: { total: 50 },
  },
};
