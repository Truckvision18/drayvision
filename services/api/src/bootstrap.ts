import { readFileSync } from 'node:fs';
import { loadConfig, missingRequiredEnv, type AppConfig } from '../config/index.js';
import { MemoryCache, type Cache } from './cache/cache.js';
import { Meter } from './cache/meter.js';
import { RedisCache } from './cache/redis.js';
import type { AppContext } from './context.js';
import { loadData } from './data.js';
import { PgRepository } from './db/pg.js';
import { MemoryRepository } from './db/repo.js';
import { fromRoot } from './paths.js';
import { createProviders } from './providers/index.js';

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
  const repo = env.DATABASE_URL ? new PgRepository(env.DATABASE_URL) : new MemoryRepository(data.facilities);

  return {
    config,
    providers: createProviders(config, env, { routingGraphVersion: data.routingGraphVersion }),
    cache,
    meter: new Meter(config.budgets),
    repo,
    data,
    build: { version: readVersion(), gitSha: env.GIT_SHA ?? 'dev' },
    external: { db: !!env.DATABASE_URL, cache: useRedis },
    now: () => new Date(),
  };
}
