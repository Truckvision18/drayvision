import type { AppConfig, DeepPartial } from './types.js';

/** Unit tests: no live keys, no network, no Docker. Every provider is mocked. */
export const test: DeepPartial<AppConfig> = {
  providers: {
    routing: 'mock',
    tolls: 'mock',
    traffic: 'mock',
    cameras: 'mock',
    imagery: 'mock',
  },
  requiredEnv: [],
  cache: { backend: 'memory' },
  tiles: { source: 'mock' },
};
