import type { AppConfig, DeepPartial } from './types.js';

export const dev: DeepPartial<AppConfig> = {
  requiredEnv: ['DATABASE_URL', 'REDIS_URL', 'MAPTILER_KEY'],
  budgets: {
    // Developer sandbox ceiling — keeps accidental loops from running up a bill.
    monthlyUsd: { total: 50 },
  },
};
