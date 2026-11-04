import type { AppConfig, DeepPartial } from './types.js';
import { pilot } from './pilot.js';

/** Production starts as pilot. Budgets MUST be re-set from Phase 13 metered actuals before scaling. */
export const prod: DeepPartial<AppConfig> = {
  ...pilot,
  rateLimits: { windowSeconds: 60 },
};
