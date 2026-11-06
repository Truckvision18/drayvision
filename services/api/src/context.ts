import type { AppConfig } from '../config/index.js';
import type { Cache } from './cache/cache.js';
import type { Meter } from './cache/meter.js';
import type { DataBundle } from './data.js';
import type { Repository } from './db/repo.js';
import type { ProfileRepository } from './profiles/repo.js';
import type { Providers } from './providers/types.js';
import type { TileUpstream } from './tiles/upstream.js';
import type { MapUsageStore } from './tiles/usage.js';

/** Everything a route handler needs. Built once at boot; fully injectable for tests. */
export interface AppContext {
  config: AppConfig;
  providers: Providers;
  cache: Cache;
  meter: Meter;
  repo: Repository;
  /** Truck profiles, per account (server-side source of truth). */
  profiles: ProfileRepository;
  data: DataBundle;
  /** Active base-map tile upstream; null when devices fetch tiles directly from the provider. */
  tiles: TileUpstream | null;
  /** Map sessions / requests per device per day. */
  mapUsage: MapUsageStore;
  /** Process environment (tile config reads deployment flags / keys from it). */
  env: NodeJS.ProcessEnv;
  build: { version: string; gitSha: string };
  /** Whether DB / cache are real external services (vs. in-memory stand-ins). */
  external: { db: boolean; cache: boolean };
  now: () => Date;
}
