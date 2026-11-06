import { readFileSync } from 'node:fs';
import { loadConfig, missingRequiredEnv, type AppConfig } from '../config/index.js';
import { MemoryCache, type Cache } from './cache/cache.js';
import { Meter } from './cache/meter.js';
import { RedisCache } from './cache/redis.js';
import type { AppContext } from './context.js';
import { loadData } from './data.js';
import pg from 'pg';
import { PgRepository } from './db/pg.js';
import { PgProfileRepository } from './profiles/pg.js';
import { MemoryProfileRepository } from './profiles/repo.js';
import { MemoryRepository } from './db/repo.js';
import { fromRoot } from './paths.js';
import { createProviders } from './providers/index.js';
import { createTileUpstream } from './tiles/service.js';
import { MemoryMapUsage, PgMapUsage } from './tiles/usage.js';

export class MissingEnvError extends Error {
  constructor(readonly missing: string[], env: string) {
    super(
      `Missing required environment variables for DRAYVISION_ENV=${env}:\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        '\nSet them in .env (see infra/.env.example).',
    );
  }
}

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(fromRoot('services/api/package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/** Build the real runtime context from config + environment. Fails fast on missing keys. */
export function createContext(config: AppConfig = loadConfig(), env: NodeJS.ProcessEnv = process.env): AppContext {
  const missing = missingRequiredEnv(config, env);
  if (missing.length > 0) throw new MissingEnvError(missing, config.environment);

  const data = loadData(config);
  const useRedis = config.cache.backend === 'redis' && !!env.REDIS_URL;
  const cache: Cache = useRedis ? new RedisCache(env.REDIS_URL!, config.cache.keyPrefix) : new MemoryCache(config.cache.memoryMaxEntries);
  const pool = env.DATABASE_URL ? new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 }) : null;
  pool?.on('error', () => undefined);
  const repo = pool ? new PgRepository(pool) : new MemoryRepository(data.facilities);
  // Without a database, profiles live in memory and vanish on restart — fine for dev only.
  const profiles = pool ? new PgProfileRepository(pool) : new MemoryProfileRepository();

  return {
    config,
    providers: createProviders(config, env, { routingGraphVersion: data.routingGraphVersion }),
    cache,
    meter: new Meter(config.budgets),
    repo,
    profiles,
    tiles: createTileUpstream(config, env),
    mapUsage: pool ? new PgMapUsage(pool, config.analytics.flushIntervalSeconds) : new MemoryMapUsage(),
    env,
    data,
    build: { version: readVersion(), gitSha: env.GIT_SHA ?? 'dev' },
    external: { db: !!env.DATABASE_URL, cache: useRedis },
    now: () => new Date(),
  };
}
