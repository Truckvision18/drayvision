import type { AppConfig } from '../config/index.js';
import type { Cache } from './cache/cache.js';
import type { Meter } from './cache/meter.js';
import type { DataBundle } from './data.js';
import type { Repository } from './db/repo.js';
import type { ProfileRepository } from './profiles/repo.js';
import type { Providers } from './providers/types.js';

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
  build: { version: string; gitSha: string };
  /** Whether DB / cache are real external services (vs. in-memory stand-ins). */
  external: { db: boolean; cache: boolean };
  now: () => Date;
}
