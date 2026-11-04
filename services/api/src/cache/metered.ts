import type { AppConfig, MeteredProvider } from '../../config/index.js';
import { decideUse } from '../rights/registry.js';
import type { Cache } from './cache.js';
import type { Meter } from './meter.js';

export class BudgetExceededError extends Error {
  readonly statusCode = 503;
  constructor(provider: string) {
    super(`Monthly budget for ${provider} reached; serving cache only`);
  }
}

export class RightsDeniedError extends Error {
  readonly statusCode = 451;
}

export interface MeteredDeps {
  cache: Cache;
  meter: Meter;
  config: AppConfig;
}

export interface MeteredResult<T> {
  value: T;
  cached: boolean;
}

/**
 * The one path every metered provider call goes through:
 *   rights check → cache lookup → budget check → provider call → meter → cache store.
 * TTL is min(config TTL for the provider, rights ceiling for the source).
 */
export async function meteredCall<T>(
  deps: MeteredDeps,
  opts: { provider: MeteredProvider; rightsId: string; key: string; ttlSeconds?: number },
  fetcher: () => Promise<T>,
): Promise<MeteredResult<T>> {
  const { cache, meter, config } = deps;
  const decision = decideUse(opts.rightsId, opts.ttlSeconds ?? config.cache.ttlSeconds[opts.provider], config.rights.allowUnverified);
  if (!decision.allowed) throw new RightsDeniedError(decision.reason);

  const cacheKey = `${opts.provider}:${opts.key}`;
  if (decision.cacheTtlSeconds > 0) {
    const hit = await cache.get(cacheKey).catch(() => null);
    if (hit !== null) {
      meter.recordCacheHit(opts.provider);
      return { value: JSON.parse(hit) as T, cached: true };
    }
  }

  if (meter.budgetState(opts.provider) === 'hard-stop') throw new BudgetExceededError(opts.provider);

  const value = await fetcher();
  meter.recordCall(opts.provider);
  if (decision.cacheTtlSeconds > 0) {
    await cache.set(cacheKey, JSON.stringify(value), decision.cacheTtlSeconds).catch(() => undefined);
  }
  return { value, cached: false };
}

/** Stable cache key from arbitrary JSON input (sorted keys). */
export function stableKey(input: unknown): string {
  const norm = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
      : Array.isArray(v)
        ? v.map(norm)
        : v;
  return JSON.stringify(norm(input));
}
