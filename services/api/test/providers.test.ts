import { EngineRouteSchema } from '@drayvision/shared';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/index.js';
import { createProviders } from '../src/providers/index.js';
import { decodePolyline } from '../src/providers/polyline.js';
import { mapManeuverType, NoRouteError, ValhallaRouting } from '../src/providers/valhalla.js';
import { rig } from './helpers.js';

describe('provider factory', () => {
  it('builds all-mock providers for the test env with no keys', () => {
    const p = createProviders(loadConfig('test', {}, {}), {});
    expect(Object.values(p).map((x) => x.name)).toEqual(Array(5).fill('mock'));
  });

  it('fails at boot when a live provider is selected without its key', () => {
    expect(() => createProviders(loadConfig('pilot', {}, {}), {})).toThrow(/TOLLSMART_API_KEY/);
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
        length: 21,
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

  it('flags hazmat when the profile carries it', () => {
    const prefs = loadConfig('test', {}, {}).routing.truckCosting;
    const t = ValhallaRouting.costingOptions({ ...rig, hazmat: { carrying: true, classes: [3] } }, prefs).truck as Record<string, unknown>;
    expect(t.hazmat).toBe(true);
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
    expect(EngineRouteSchema.parse(r)).toEqual(r); // adapter output IS the shared engine shape
    expect(r?.distance_m).toBe(1500);
    expect(r?.graph_version).toBe('2026-11-01');
    expect(r?.maneuvers[0]).toMatchObject({ type: 'depart', verbal_instruction: 'Drive north.', begin_shape_index: 0, end_shape_index: 1 });
    expect(r?.maneuvers[1]?.type).toBe('arrive');
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
