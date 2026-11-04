import { describe, expect, it } from 'vitest';
import { deepMerge, ENVIRONMENTS, loadConfig, missingRequiredEnv, resolveEnvironment } from '../config/index.js';

describe('config', () => {
  it.each(ENVIRONMENTS)('loads and validates the %s environment', (env) => {
    const c = loadConfig(env, {}, {});
    expect(c.environment).toBe(env);
    expect(c.cache.ttlSeconds.tolls).toBeGreaterThan(0);
  });

  it('test env mocks every provider and needs no keys', () => {
    const c = loadConfig('test', {}, {});
    expect(Object.values(c.providers).every((p) => p === 'mock')).toBe(true);
    expect(missingRequiredEnv(c, {})).toEqual([]);
  });

  it('pilot and prod refuse unverified rights and require live keys', () => {
    for (const env of ['pilot', 'prod'] as const) {
      const c = loadConfig(env, {}, {});
      expect(c.rights.allowUnverified).toBe(false);
      expect(missingRequiredEnv(c, {})).toEqual(expect.arrayContaining(['MAPTILER_KEY', 'TOLLSMART_API_KEY', 'NY511_API_KEY']));
    }
  });

  it('pilot budget is the top of the preliminary planning range', () => {
    expect(loadConfig('pilot', {}, {}).budgets.monthlyUsd.total).toBe(2500);
  });

  it('per-environment overrides beat defaults; extra overrides beat both', () => {
    const c = loadConfig('dev', { safety: { clearanceMarginM: 0.5 } }, {});
    expect(c.safety.clearanceMarginM).toBe(0.5);
    expect(c.safety.hazardMatchRadiusM).toBe(25); // untouched default survives
  });

  it('rejects invalid values loudly', () => {
    expect(() => loadConfig('dev', { server: { port: 70_000 } }, {})).toThrow(/server.port/);
  });

  it('rejects unknown environments', () => {
    expect(() => resolveEnvironment('staging')).toThrow(/DRAYVISION_ENV/);
  });

  it('treats blank env vars as missing', () => {
    const c = loadConfig('dev', {}, {});
    expect(missingRequiredEnv(c, { DATABASE_URL: 'x', REDIS_URL: 'y', MAPTILER_KEY: '  ' })).toEqual(['MAPTILER_KEY']);
  });

  it('deepMerge replaces arrays rather than concatenating', () => {
    expect(deepMerge({ a: [1, 2], b: { c: 1 } }, { a: [3] })).toEqual({ a: [3], b: { c: 1 } });
  });
});
