import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import { MemoryCache } from '../src/cache/cache.js';
import { meteredCall, RightsDeniedError, stableKey } from '../src/cache/metered.js';
import { Meter } from '../src/cache/meter.js';
import { RateLimiter } from '../src/cache/rateLimit.js';

describe('MemoryCache', () => {
  it('expires entries by TTL and evicts beyond capacity', async () => {
    let t = 0;
    const c = new MemoryCache(2, () => t);
    await c.set('a', '1', 10);
    expect(await c.get('a')).toBe('1');
    t = 10_001;
    expect(await c.get('a')).toBeNull();
    await c.set('x', '1', 10);
    await c.set('y', '2', 10);
    await c.set('z', '3', 10);
    expect(c.size).toBe(2);
    expect(await c.get('x')).toBeNull();
  });

  it('never stores zero-TTL values', async () => {
    const c = new MemoryCache(10);
    await c.set('a', '1', 0);
    expect(await c.get('a')).toBeNull();
  });
});

describe('Meter', () => {
  it('counts unpriced calls without inventing spend', () => {
    const m = new Meter(loadConfig('test', {}, {}).budgets);
    m.recordCall('tolls');
    // tolls are unpriced → no spend invented for them (the total only sums priced providers)
    expect(m.snapshot()).toMatchObject({ calls: { tolls: 1 }, spendUsd: { tolls: null }, totalSpendUsd: 0 });
    expect(m.budgetState('tolls')).toBe('ok');
  });

  it('alerts and hard-stops at configured fractions and rolls over monthly', () => {
    let now = new Date('2026-11-04T00:00:00Z');
    const budgets = loadConfig('test', { budgets: { unitCostUsd: { traffic: 1 }, monthlyUsd: { total: 10 } } }, {}).budgets;
    const m = new Meter(budgets, () => now);
    for (let i = 0; i < 8; i++) m.recordCall('traffic');
    expect(m.budgetState('traffic')).toBe('alert');
    m.recordCall('traffic');
    m.recordCall('traffic');
    expect(m.budgetState('traffic')).toBe('hard-stop');
    now = new Date('2026-12-01T00:00:00Z');
    expect(m.budgetState('traffic')).toBe('ok');
  });
});

describe('meteredCall + rights', () => {
  it('refuses unverified sources when the environment requires verified rights', async () => {
    const config = loadConfig('test', { rights: { allowUnverified: false } }, {});
    const deps = { config, cache: new MemoryCache(10), meter: new Meter(config.budgets) };
    await expect(meteredCall(deps, { provider: 'tolls', rightsId: 'tollsmart', key: 'k' }, async () => 1)).rejects.toBeInstanceOf(RightsDeniedError);
  });

  it('does not cache sources whose rights forbid caching', async () => {
    const config = loadConfig('test', {}, {});
    const deps = { config, cache: new MemoryCache(10), meter: new Meter(config.budgets) };
    let n = 0;
    const call = () => meteredCall(deps, { provider: 'imagery', rightsId: 'google-imagery', key: 'k' }, async () => ++n);
    await call();
    const second = await call();
    expect(second).toEqual({ value: 2, cached: false });
  });

  it('stableKey ignores key order', () => {
    expect(stableKey({ a: 1, b: { c: 2, d: 3 } })).toBe(stableKey({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe('RateLimiter', () => {
  it('resets after the window', () => {
    let t = 0;
    const r = new RateLimiter(1, () => t);
    expect(r.take('k', 1)).toBe(true);
    expect(r.take('k', 1)).toBe(false);
    t = 1000;
    expect(r.take('k', 1)).toBe(true);
  });
});
