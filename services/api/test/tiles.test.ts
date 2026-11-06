import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { layerAnchorId, MAP_LAYER_ORDER, MapUsageResponseSchema, RestrictionsResponseSchema, TileConfigSchema } from '@drayvision/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import { buildApp } from '../src/app.js';
import { createContext } from '../src/bootstrap.js';
import { createTileUpstream, TileConfigError } from '../src/tiles/service.js';
import { classify, HttpTileUpstream } from '../src/tiles/upstream.js';
import { hazard, testApp } from './helpers.js';

/**
 * A stand-in for both MapTiler (/maptiler/…, key required) and our own tile server
 * (/selfhosted/…). Counts every request it receives — that's what the provider would bill.
 */
let stub: Server;
let STUB = '';
const hits: string[] = [];
beforeAll(async () => {
  stub = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    hits.push(url.pathname);
    const json = (o: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (url.pathname.startsWith('/maptiler/') && url.searchParams.get('key') !== 'SERVER_KEY') {
      res.writeHead(403);
      return res.end('bad key');
    }
    if (url.pathname === '/maptiler/maps/streets-v2/style.json') {
      return json({
        version: 8,
        sources: { openmaptiles: { type: 'vector', url: `${STUB}/maptiler/tiles/v3/tiles.json?key=SERVER_KEY` } },
        glyphs: `${STUB}/maptiler/fonts/{fontstack}/{range}.pbf?key=SERVER_KEY`,
        sprite: `${STUB}/maptiler/maps/streets-v2/sprite`,
        layers: [{ id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' }],
      });
    }
    if (url.pathname === '/maptiler/tiles/v3/tiles.json') return json({ tiles: [`${STUB}/maptiler/tiles/v3/{z}/{x}/{y}.pbf?key=SERVER_KEY`] });
    if (url.pathname.endsWith('.pbf')) {
      if (req.headers['if-none-match'] === '"t1"') {
        res.writeHead(304, { etag: '"t1"' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/x-protobuf', etag: '"t1"' });
      return res.end(Buffer.from([1, 2, 3]));
    }
    if (url.pathname.endsWith('.png')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(Buffer.from([9]));
    }
    if (url.pathname === '/selfhosted/styles/drayvision/style.json') {
      return json({
        version: 8,
        sources: { osm: { type: 'vector', tiles: [`${STUB}/selfhosted/data/osm/{z}/{x}/{y}.pbf`] } },
        layers: [{ id: 'road', type: 'line', source: 'osm', 'source-layer': 'roads' }],
      });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  STUB = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => stub.close(() => r())));

/** Boot the REAL app (createContext) from environment variables only — no code changes. */
function bootFromEnv(env: Record<string, string>) {
  const full = { DRAYVISION_ENV: 'dev', ...env };
  // No database / cache in unit tests; the tile keys are still required per the selected source.
  const config = loadConfig('dev', { requiredEnv: [], tiles: { maptiler: { baseUrl: `${STUB}/maptiler/` } } }, full);
  const ctx = createContext(config, full);
  return { ctx, app: buildApp(ctx) };
}
const dev = (env: Record<string, string> = {}) => ({ DATABASE_URL: '', REDIS_URL: '', ...env });
const H = { host: 'api.test', 'x-device-id': 'device-A' };

describe('tile source flag: switching needs only config, not code or an app release', () => {
  it('TILE_SOURCE=maptiler → MapTiler via our proxy, keys stripped, request-billed', async () => {
    const { app } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', MAPTILER_KEY: 'SERVER_KEY' }));
    const cfg = TileConfigSchema.parse((await app.inject({ url: '/tiles/config', headers: H })).json());
    expect(cfg).toMatchObject({
      source: 'maptiler',
      delivery: 'proxy',
      style_url: 'http://api.test/tiles/maptiler/style.json',
      layer_anchors: true,
      billing_unit: 'request',
      export: { snapshot_allowed: false },
      prefetch: { enabled: false },
    });
    expect(cfg.attribution.map((a) => a.text)).toEqual(['© MapTiler', '© OpenStreetMap contributors']);
    const style = await app.inject({ url: '/tiles/maptiler/style.json', headers: H });
    expect(style.body).not.toContain('SERVER_KEY');
    expect(style.body).not.toContain(STUB);
    expect(style.json().sources.openmaptiles.url).toBe('http://api.test/tiles/maptiler/proxy/tiles/v3/tiles.json');
  });

  it('TILE_SOURCE=self-hosted → same app build now serves our own tiles; old MapTiler URLs are 410', async () => {
    const { app } = bootFromEnv(dev({ TILE_SOURCE: 'self-hosted', SELF_HOSTED_TILES_URL: `${STUB}/selfhosted/` }));
    const cfg = TileConfigSchema.parse((await app.inject({ url: '/tiles/config', headers: H })).json());
    expect(cfg).toMatchObject({ source: 'self-hosted', style_url: 'http://api.test/tiles/self-hosted/style.json', billing_unit: 'none', export: { snapshot_allowed: true }, prefetch: { enabled: true } });
    expect(cfg.attribution.map((a) => a.text)).toEqual(['© OpenStreetMap contributors']);
    const style = (await app.inject({ url: '/tiles/self-hosted/style.json', headers: H })).json();
    expect(style.sources.osm.tiles[0]).toBe('http://api.test/tiles/self-hosted/proxy/data/osm/{z}/{x}/{y}.pbf');
    const old = await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/1/2/3.pbf', headers: H });
    expect(old.statusCode).toBe(410);
    expect(old.json().error).toBe('TILE_SOURCE_CHANGED');
    // config_version changes whenever the source changes, so clients can tell.
    const { app: mt } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', MAPTILER_KEY: 'SERVER_KEY' }));
    expect((await mt.inject({ url: '/tiles/config', headers: H })).json().config_version).not.toBe(cfg.config_version);
  });

  it('TILE_DELIVERY=direct → the app gets a client-key style URL straight from MapTiler (no proxy)', async () => {
    const { app } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', TILE_DELIVERY: 'direct', MAPTILER_CLIENT_KEY: 'CLIENT_KEY' }));
    const cfg = (await app.inject({ url: '/tiles/config', headers: H })).json();
    expect(cfg).toMatchObject({ delivery: 'direct', layer_anchors: false, style_url: `${STUB}/maptiler/maps/streets-v2/style.json?key=CLIENT_KEY` });
    expect(cfg.style_url).not.toContain('SERVER_KEY');
    expect((await app.inject({ url: '/tiles/style.json', headers: H })).statusCode).toBe(410);
  });

  it('missing keys for the selected source fail at boot, loudly', () => {
    expect(() => bootFromEnv(dev({ TILE_SOURCE: 'maptiler' }))).toThrow(/MAPTILER_KEY/);
    expect(() => bootFromEnv(dev({ TILE_SOURCE: 'self-hosted' }))).toThrow(/SELF_HOSTED_TILES_URL/);
    expect(() => bootFromEnv(dev({ TILE_SOURCE: 'maptiler', TILE_DELIVERY: 'direct' }))).toThrow(/MAPTILER_CLIENT_KEY/);
  });
});

describe('MapTiler terms guards', () => {
  it('pilot/prod refuse to proxy MapTiler without written approval (Cloud Terms §6)', () => {
    const pilot = loadConfig('pilot', {}, {});
    expect(() => createTileUpstream(pilot, { MAPTILER_KEY: 'k' })).toThrow(TileConfigError);
    expect(() => createTileUpstream(pilot, { MAPTILER_KEY: 'k' })).toThrow(/written approval/);
    const approved = loadConfig('pilot', {}, { MAPTILER_PROXY_APPROVAL_REF: 'MT-2026-123' });
    expect(createTileUpstream(approved, { MAPTILER_KEY: 'k' })?.source).toBe('maptiler');
    const self = loadConfig('pilot', {}, { TILE_SOURCE: 'self-hosted' });
    expect(createTileUpstream(self, { SELF_HOSTED_TILES_URL: 'http://tiles.internal/' })?.source).toBe('self-hosted');
  });

  it('MapTiler content is never served from a server-side cache (Cloud Terms §7): every request goes upstream', async () => {
    const { app } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', MAPTILER_KEY: 'SERVER_KEY' }));
    hits.length = 0;
    for (let i = 0; i < 3; i++) await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/5/6/7.pbf', headers: H });
    expect(hits.filter((h) => h.endsWith('/5/6/7.pbf'))).toHaveLength(3);
  });

  it('tells devices to cache privately (single end-user cache), never shared', async () => {
    const { app } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', MAPTILER_KEY: 'SERVER_KEY' }));
    const r = await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/5/6/7.pbf', headers: H });
    expect(r.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    expect(r.headers.etag).toBe('"t1"');
  });

  it('forwards conditional requests: a device revalidating a cached tile gets a 304 (counted as a request)', async () => {
    const { ctx, app } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', MAPTILER_KEY: 'SERVER_KEY' }));
    const r = await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/5/6/7.pbf', headers: { ...H, 'if-none-match': '"t1"' } });
    expect(r.statusCode).toBe(304);
    const [day] = await ctx.mapUsage.day(new Date().toISOString().slice(0, 10), null);
    expect(day?.upstream_requests).toBe(1);
  });

  it('our own (self-hosted, OSM) tiles may be cached server-side', async () => {
    const { app } = bootFromEnv(dev({ TILE_SOURCE: 'self-hosted', SELF_HOSTED_TILES_URL: `${STUB}/selfhosted/` }));
    hits.length = 0;
    for (let i = 0; i < 3; i++) await app.inject({ url: '/tiles/self-hosted/proxy/data/osm/1/1/1.pbf', headers: H });
    expect(hits.filter((h) => h.endsWith('/1/1/1.pbf'))).toHaveLength(1);
  });
});

describe('billing unit: MapTiler bills this integration per request, weighted by kind', () => {
  it('classifies resources like the provider’s billing table', () => {
    expect(classify('maps/streets-v2/style.json', 'application/json')).toBe('style');
    expect(classify('tiles/v3/tiles.json', 'application/json')).toBe('tilejson');
    expect(classify('fonts/Noto Sans/0-255.pbf', 'application/x-protobuf')).toBe('font');
    expect(classify('maps/streets-v2/sprite@2x.png', 'image/png')).toBe('sprite');
    expect(classify('tiles/v3/14/1/2.pbf', 'application/x-protobuf')).toBe('vector_tile');
    expect(classify('maps/streets/256/1/2/3.png', 'image/png')).toBe('raster_tile_256');
    expect(classify('maps/streets/1/2/3.png', 'image/png')).toBe('raster_tile_512');
  });

  it('counts sessions and requests per device per day, and billable requests the provider’s way', async () => {
    const { ctx, app } = bootFromEnv(dev({ TILE_SOURCE: 'maptiler', MAPTILER_KEY: 'SERVER_KEY' }));
    const A = H;
    const B = { ...H, 'x-device-id': 'device-B' };
    await app.inject({ url: '/tiles/maptiler/style.json', headers: A }); // style: 0
    await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/tiles.json', headers: A }); // tilejson: 0
    await app.inject({ url: '/tiles/maptiler/proxy/fonts/Noto/0-255.pbf', headers: A }); // font: 0
    for (let i = 0; i < 5; i++) await app.inject({ url: `/tiles/maptiler/proxy/tiles/v3/14/${i}/1.pbf`, headers: A }); // 5 × 1
    await app.inject({ url: '/tiles/maptiler/proxy/maps/streets/1/2/3.png', headers: B }); // 512px raster: 4
    const session = (id: string, h: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/analytics/map-sessions', headers: h, payload: { session_id: id, view: 'plan', started_at: new Date().toISOString() } });
    expect((await session('s-1', A)).statusCode).toBe(201);
    expect((await session('s-1', A)).json()).toEqual({ recorded: false }); // re-sent report counted once
    await session('s-2', B);

    const me = MapUsageResponseSchema.parse((await app.inject({ url: '/usage/maps/me', headers: A })).json());
    expect(me.days[0]).toMatchObject({ source: 'maptiler', sessions: 1, proxy_requests: 8, billable_requests: 5 });

    const all = MapUsageResponseSchema.parse((await app.inject({ url: '/usage/maps', headers: A })).json());
    expect(all.days[0]).toMatchObject({ sessions: 2, proxy_requests: 9, upstream_requests: 9, billable_requests: 9, estimated_cost_usd: 0.00135 });
    expect(all.days[0]!.by_kind).toEqual({ style: 1, tilejson: 1, font: 1, vector_tile: 5, raster_tile_512: 1 });
    expect(all.per_device!.map((d) => [d.device_id, d.sessions, d.proxy_requests, d.billable_requests])).toEqual([
      ['device-A', 1, 8, 5],
      ['device-B', 1, 1, 4],
    ]);
    expect(ctx.meter.snapshot().calls.tiles).toBe(9);
  });

  it('stops calling MapTiler at the budget hard-stop', async () => {
    const config = loadConfig('dev', { requiredEnv: [], tiles: { maptiler: { baseUrl: `${STUB}/maptiler/` } }, budgets: { monthlyUsd: { tiles: 0.0001 } } }, dev({ MAPTILER_KEY: 'SERVER_KEY' }));
    const ctx = createContext(config, dev({ MAPTILER_KEY: 'SERVER_KEY' }));
    const app = buildApp(ctx);
    await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/1/1/1.pbf', headers: H });
    const r = await app.inject({ url: '/tiles/maptiler/proxy/tiles/v3/1/1/2.pbf', headers: H });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe('BUDGET_EXCEEDED');
  });

  it('the all-devices usage endpoint needs an ops token outside dev/test', async () => {
    const { app } = testApp({ config: { environment: 'pilot' } as never });
    expect((await app.inject({ url: '/usage/maps' })).statusCode).toBe(403);
  });
});

describe('style + layers', () => {
  it('every served style ends with the overlay anchors in the required z-order', async () => {
    const { app } = testApp();
    const style = (await app.inject({ url: '/tiles/style.json' })).json();
    const ids = style.layers.map((l: { id: string }) => l.id);
    expect(ids.slice(-7)).toEqual([...MAP_LAYER_ORDER, 'top' as const].map((l) => layerAnchorId(l)));
    expect(ids[0]).toBe('background'); // base map stays underneath
  });

  it('rewrites upstream URLs and strips the key', () => {
    const up = new HttpTileUpstream('maptiler', 'https://api.maptiler.com/', 'x', 'maptiler', { param: 'key', value: 'K' });
    const out = up.rewrite(JSON.stringify({ a: 'https://api.maptiler.com/tiles/v3/tiles.json?key=K', b: 'https://api.maptiler.com/x.pbf?lang=en&key=K' }), 'http://api/tiles/maptiler/proxy/');
    expect(out).not.toContain('K"');
    expect(JSON.parse(out)).toEqual({ a: 'http://api/tiles/maptiler/proxy/tiles/v3/tiles.json', b: 'http://api/tiles/maptiler/proxy/x.pbf?lang=en' });
  });

  it('GET /restrictions returns unresolved verified records in the bbox (hazards layer)', async () => {
    const { app } = testApp({
      restrictions: [
        hazard({ id: 'in', type: 'LOW_CLEARANCE', value: 3.9, location: { lng: -74, lat: 40.7 } }),
        hazard({ id: 'retired', type: 'LOW_CLEARANCE', value: 3.9, location: { lng: -74, lat: 40.7 }, resolved: true }),
        hazard({ id: 'out', type: 'LOW_CLEARANCE', value: 3.9, location: { lng: 0, lat: 0 } }),
      ],
    });
    const body = RestrictionsResponseSchema.parse((await app.inject({ url: '/restrictions?bbox=-74.1,40.6,-73.9,40.8' })).json());
    expect(body.restrictions.map((r) => r.id)).toEqual(['in']);
  });
});
