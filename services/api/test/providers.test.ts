import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/index.js';
import { createProviders } from '../src/providers/index.js';
import { MapTilerTiles } from '../src/providers/maptiler.js';
import { decodePolyline } from '../src/providers/polyline.js';
import { mapManeuverType, NoRouteError, ValhallaRouting } from '../src/providers/valhalla.js';
import { rig } from './helpers.js';

describe('provider factory', () => {
  it('builds all-mock providers for the test env with no keys', () => {
    const p = createProviders(loadConfig('test', {}, {}), {});
    expect(Object.values(p).map((x) => x.name)).toEqual(Array(6).fill('mock'));
  });

  it('fails at boot when a live provider is selected without its key', () => {
    expect(() => createProviders(loadConfig('pilot', {}, {}), {})).toThrow(/MAPTILER_KEY/);
  });
});

describe('MapTiler proxy rewriting', () => {
  it('strips the key and points every upstream URL at our proxy', () => {
    const style = JSON.stringify({
      sources: { s: { url: 'https://api.maptiler.com/tiles/v3/tiles.json?key=SECRET' } },
      glyphs: 'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=SECRET',
    });
    const out = MapTilerTiles.rewrite(style, 'http://api.local');
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('api.maptiler.com');
    expect(out).toContain('http://api.local/tiles/proxy/tiles/v3/tiles.json');
  });

  it('maps network failures to a 502 without leaking the key', async () => {
    const t = new MapTilerTiles('K', 'streets-v2', (async () => {
      throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.maptiler.com');
    }) as unknown as typeof fetch);
    const err = await t.style('http://api.local').catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 502, message: 'tile provider unavailable' });
  });

  it('appends the key server-side only', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"tiles":["https://api.maptiler.com/x?key=K"]}', { headers: { 'content-type': 'application/json' } }));
    const t = new MapTilerTiles('K', 'streets-v2', fetchImpl as unknown as typeof fetch);
    const r = await t.resource('tiles/v3/tiles.json', new URLSearchParams(), 'http://api.local');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('key=K');
    expect(r.body.toString()).toBe('{"tiles":["http://api.local/tiles/proxy/x"]}');
  });
});

const valhallaOpts = (fetchImpl: unknown, graphVersion = '2026-11-01') => ({
  baseUrl: 'http://valhalla',
  timeoutMs: 1000,
  alternates: 2,
  truckCosting: loadConfig('test', {}, {}).routing.truckCosting,
  graphVersion,
  fetchImpl: fetchImpl as typeof fetch,
});

const trip = {
  summary: { length: 1.5, time: 120 },
  legs: [
    {
      shape: '_p~iF~ps|U_ulLnnqC',
      summary: { length: 1.5, time: 120 },
      maneuvers: [
        { instruction: 'Go', verbal_pre_transition_instruction: 'Drive north.', type: 1, length: 1.5, time: 120, begin_shape_index: 0, end_shape_index: 1 },
        { instruction: 'Arrive', type: 4, length: 0, time: 0, begin_shape_index: 1, end_shape_index: 1 },
      ],
    },
  ],
};

describe('Valhalla adapter', () => {
  it('maps TruckProfile + configured preferences to truck costing in metres / tonnes', () => {
    const prefs = loadConfig('test', {}, {}).routing.truckCosting;
    expect(ValhallaRouting.costingOptions(rig, prefs)).toEqual({
      truck: {
        height: 4.11,
        width: 2.59,
        length: 20.7,
        weight: 36,
        axle_count: 5,
        hazmat: false,
        use_highways: prefs.useHighways,
        use_tolls: prefs.useTolls,
        use_living_streets: prefs.useLivingStreets,
        use_tracks: prefs.useTracks,
        top_speed: prefs.topSpeedKph,
      },
    });
  });

  it('flags hazmat and axle load when present', () => {
    const prefs = loadConfig('test', {}, {}).routing.truckCosting;
    const t = ValhallaRouting.costingOptions({ ...rig, hazmat: [3], axleLoadKg: 9000 }, prefs).truck as Record<string, unknown>;
    expect(t.hazmat).toBe(true);
    expect(t.axle_load).toBe(9);
  });

  it('maps maneuver codes onto our enum', () => {
    expect([1, 4, 10, 15, 26, 99].map(mapManeuverType)).toEqual(['depart', 'arrive', 'right', 'left', 'roundabout-enter', 'other']);
  });

  it('decodes precision-6 polylines', () => {
    // Google's reference polyline "_p~iF~ps|U_ulLnnqC_mqNvxq`@" at precision 5
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts[0]).toEqual([-120.2, 38.5]);
    expect(pts[2]).toEqual([-126.453, 43.252]);
  });

  it('parses /route with alternates, voice text, shape indices and graph version', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { alternates?: number; costing: string };
      expect(body).toMatchObject({ costing: 'truck', alternates: 2 });
      return new Response(JSON.stringify({ trip, alternates: [{ trip }] }));
    });
    const routes = await new ValhallaRouting(valhallaOpts(fetchImpl)).route({ origin: { lng: 0, lat: 0 }, destination: { lng: 1, lat: 1 }, profile: rig });
    expect(routes).toHaveLength(2);
    const [r] = routes;
    expect(r?.distanceM).toBe(1500);
    expect(r?.graphVersion).toBe('2026-11-01');
    expect(r?.legs[0]?.maneuvers[0]).toMatchObject({ type: 'depart', verbalInstruction: 'Drive north.', beginShapeIndex: 0, endShapeIndex: 1 });
    expect(r?.legs[0]?.maneuvers[1]?.type).toBe('arrive');
  });

  it('turns "no path" errors into a 422 NoRouteError', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error_code: 442, error: 'No path could be found for input', status_code: 400 }), { status: 400 }));
    const err = await new ValhallaRouting(valhallaOpts(fetchImpl))
      .route({ origin: { lng: 0, lat: 0 }, destination: { lng: 1, lat: 1 }, profile: rig })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoRouteError);
    expect(err).toMatchObject({ statusCode: 422 });
  });

  it('turns network failures and 5xx into a 502', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const req = { origin: { lng: 0, lat: 0 }, destination: { lng: 1, lat: 1 }, profile: rig };
    await expect(new ValhallaRouting(valhallaOpts(down)).route(req)).rejects.toMatchObject({ statusCode: 502 });
    const boom = vi.fn(async () => new Response('{}', { status: 500 }));
    await expect(new ValhallaRouting(valhallaOpts(boom)).route(req)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('reports the dated extract as graph version, falling back to tileset mtime', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tileset_last_modified: 1_767_225_600 })));
    expect(await new ValhallaRouting(valhallaOpts(fetchImpl)).status()).toEqual({ up: true, graphVersion: '2026-11-01' });
    expect(await new ValhallaRouting(valhallaOpts(fetchImpl, 'not-built')).status()).toEqual({ up: true, graphVersion: '2026-01-01T00:00:00.000Z' });
  });
});
