/**
 * Map usage store behaviour, run against memory and (opt-in, PG_IT_URL) Postgres, so the
 * numbers the debug panel shows are the numbers that land in the database.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryMapUsage, PgMapUsage, type MapUsageStore, type RequestEvent } from '../src/tiles/usage.js';

function behaviour(name: string, make: () => MapUsageStore): void {
  describe(`map usage: ${name}`, () => {
    // A unique far-future day per test → no cleanup needed on a shared DB.
    const uniqueDay = () => `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
    const req = (day: string, over: Partial<RequestEvent> = {}): RequestEvent => ({
      day,
      source: 'maptiler',
      kind: 'vector_tile',
      deviceId: 'dev-1',
      accountId: 'acct-1',
      upstream: true,
      revalidation: false,
      billable: 1,
      ...over,
    });

    it('aggregates requests per source/kind and per device, sessions once per id', async () => {
      const store = make();
      const day = uniqueDay();
      const dev = `dev-${randomUUID()}`;
      for (let i = 0; i < 4; i++) store.recordRequest(req(day, { deviceId: dev }));
      store.recordRequest(req(day, { deviceId: dev, kind: 'raster_tile_512', billable: 4 }));
      store.recordRequest(req(day, { deviceId: dev, kind: 'style', billable: 0 }));
      store.recordRequest(req(day, { deviceId: dev, revalidation: true }));
      const s = { day, source: 'maptiler' as const, deviceId: dev, accountId: 'acct-1', view: 'plan', startedAt: `${day}T08:00:00.000Z` };
      const id = randomUUID();
      expect(await store.recordSession({ ...s, sessionId: id })).toBe(true);
      expect(await store.recordSession({ ...s, sessionId: id })).toBe(false);
      await store.recordSession({ ...s, sessionId: randomUUID() });

      const [d] = (await store.day(day, 0.15 / 1000)).filter((x) => x.source === 'maptiler');
      expect(d).toMatchObject({ sessions: 2, proxy_requests: 7, upstream_requests: 7, billable_requests: 9, estimated_cost_usd: 0.00135 });
      expect(d!.by_kind).toEqual({ vector_tile: 5, raster_tile_512: 1, style: 1 });
      expect(await store.deviceDay(day, dev)).toEqual([
        { day, device_id: dev, account_id: 'acct-1', source: 'maptiler', sessions: 2, proxy_requests: 7, billable_requests: 9 },
      ]);
      await store.close();
    });

    it('keeps days and sources apart', async () => {
      const store = make();
      const day = uniqueDay();
      const dev = `dev-${randomUUID()}`;
      store.recordRequest(req(day, { deviceId: dev }));
      store.recordRequest(req(day, { deviceId: dev, source: 'self-hosted', billable: 0, upstream: false }));
      const days = await store.day(day, 0.15 / 1000);
      expect(days.find((x) => x.source === 'self-hosted')).toMatchObject({ proxy_requests: 1, upstream_requests: 0, estimated_cost_usd: null });
      expect((await store.deviceDay(day, dev)).map((r) => r.source).sort()).toEqual(['maptiler', 'self-hosted']);
      await store.close();
    });

    it('survives repeated flushes without double counting', async () => {
      const store = make();
      const day = uniqueDay();
      const dev = `dev-${randomUUID()}`;
      store.recordRequest(req(day, { deviceId: dev }));
      await store.flush();
      await store.flush();
      store.recordRequest(req(day, { deviceId: dev }));
      expect((await store.deviceDay(day, dev))[0]?.proxy_requests).toBe(2);
      await store.close();
    });
  });
}

behaviour('memory', () => new MemoryMapUsage());

const PG_URL = process.env.PG_IT_URL;
if (PG_URL) {
  const pool = new pg.Pool({ connectionString: PG_URL, max: 4 });
  afterAll(() => pool.end());
  behaviour('postgres', () => new PgMapUsage(pool, 3600));
} else {
  describe.skip('map usage: postgres (set PG_IT_URL to run)', () => {
    it('skipped', () => undefined);
  });
}
