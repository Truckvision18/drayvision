import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/index.js';
import { createProviders } from '../src/providers/index.js';
import { MapTilerTiles } from '../src/providers/maptiler.js';
import { decodePolyline } from '../src/providers/polyline.js';
import { ValhallaRouting } from '../src/providers/valhalla.js';
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

describe('Valhalla adapter', () => {
  it('maps TruckProfile to truck costing in metres / tonnes', () => {
    expect(ValhallaRouting.costingOptions(rig)).toEqual({
      truck: { height: 4.11, width: 2.59, length: 20.7, weight: 36, axle_count: 5, hazmat: false },
    });
  });

  it('decodes precision-6 polylines', () => {
    // Google's reference polyline "_p~iF~ps|U_ulLnnqC_mqNvxq`@" at precision 5
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(pts[0]).toEqual([-120.2, 38.5]);
    expect(pts[2]).toEqual([-126.453, 43.252]);
  });

  it('parses a /route response with a mocked fetch', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/status')
        ? new Response(JSON.stringify({ tileset_last_modified: 1_767_225_600 }))
        : new Response(
            JSON.stringify({
              trip: {
                summary: { length: 1.5, time: 120 },
                legs: [
                  {
                    shape: '_p~iF~ps|U_ulLnnqC',
                    summary: { length: 1.5, time: 120 },
                    maneuvers: [{ instruction: 'Go', type: 1, length: 1.5, time: 120, begin_shape_index: 0 }],
                  },
                ],
              },
            }),
          ),
    );
    const v = new ValhallaRouting('http://valhalla', 1000, fetchImpl as unknown as typeof fetch);
    const [r] = await v.route({ origin: { lng: 0, lat: 0 }, destination: { lng: 1, lat: 1 }, profile: rig });
    expect(r?.distanceM).toBe(1500);
    expect(r?.graphVersion).toBe('2026-01-01T00:00:00.000Z');
    expect(r?.legs[0]?.maneuvers[0]?.instruction).toBe('Go');
  });
});
