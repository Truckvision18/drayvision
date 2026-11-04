import { describe, expect, it, vi } from 'vitest';
import { mockTolls } from '../src/providers/mock.js';
import { hazard, rig, testApp } from './helpers.js';

const origin = { lng: -74.0, lat: 40.7 };
const destination = { lng: -74.0, lat: 40.71 };

describe('POST /route', () => {
  it('returns a validated route', async () => {
    const { app } = testApp();
    const res = await app.inject({ method: 'POST', url: '/route', payload: { origin, destination, profile: rig } });
    expect(res.statusCode).toBe(200);
    const [route] = res.json().routes;
    expect(route.validation).toMatchObject({ status: 'pass', restrictionsVersion: 'test-restrictions-1' });
  });

  it('withholds a route that hits a low bridge (blockOnFail)', async () => {
    const { app } = testApp({
      restrictions: [hazard({ id: 'bridge-1', kind: 'low-clearance', limit: 3.9, location: { lng: -74.0, lat: 40.705 } })],
    });
    const body = (await app.inject({ method: 'POST', url: '/route', payload: { origin, destination, profile: rig } })).json();
    expect(body.routes).toHaveLength(0);
    expect(body.rejected[0].validation.violations[0].hazardId).toBe('bridge-1');
  });

  it('rejects malformed input with 400', async () => {
    const { app } = testApp();
    const res = await app.inject({ method: 'POST', url: '/route', payload: { origin } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /tolls — metered + cached', () => {
  it('calls the provider once, then serves from cache', async () => {
    const spy = vi.fn(mockTolls.estimate);
    const { app, ctx } = testApp({ providers: { tolls: { ...mockTolls, estimate: spy } } });
    const payload = { geometry: [[-74, 40.7], [-74, 40.71]], profile: rig };
    const a = (await app.inject({ method: 'POST', url: '/tolls', payload })).json();
    const b = (await app.inject({ method: 'POST', url: '/tolls', payload })).json();
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ctx.meter.snapshot()).toMatchObject({ calls: { tolls: 1 }, cacheHits: { tolls: 1 } });
  });

  it('refuses metered calls once the budget hard-stop is hit', async () => {
    const { app } = testApp({ config: { budgets: { unitCostUsd: { tolls: 10 }, monthlyUsd: { tolls: 10 } } } });
    const mk = (n: number) => ({ geometry: [[-74, 40 + n], [-74, 41 + n]], profile: rig });
    expect((await app.inject({ method: 'POST', url: '/tolls', payload: mk(0) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/tolls', payload: mk(1) })).statusCode).toBe(503);
  });
});

describe('feeds and facilities', () => {
  it('GET /traffic requires a bbox', async () => {
    const { app } = testApp();
    expect((await app.inject({ url: '/traffic' })).statusCode).toBe(400);
    const ok = await app.inject({ url: '/traffic?bbox=-74.1,40.6,-73.9,40.8' });
    expect(ok.json().events).toHaveLength(1);
  });

  it('GET /cameras rewrites image URLs to our API, never upstream', async () => {
    const { app } = testApp();
    const body = (await app.inject({ url: '/cameras?bbox=-74.1,40.6,-73.9,40.8', headers: { host: '10.0.2.2:8080' } })).json();
    expect(body.cameras[0].imageUrl).toBe('http://10.0.2.2:8080/cameras/mock-cam-1/image');
    const img = await app.inject({ url: '/cameras/mock-cam-1/image' });
    expect(img.headers['content-type']).toBe('image/png');
  });

  it('GET /facilities, /facilities/:id, /ports', async () => {
    const { app } = testApp();
    expect((await app.inject({ url: '/facilities' })).json().facilities).toHaveLength(1);
    expect((await app.inject({ url: '/facilities?bbox=0,0,1,1' })).json().facilities).toHaveLength(0);
    expect((await app.inject({ url: '/facilities/fac-1' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/facilities/nope' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/ports' })).json().ports[0]).toMatchObject({ id: 'fac-1', latestWait: null });
  });

  it('GET /sponsored returns labelled listings', async () => {
    const { app } = testApp();
    expect((await app.inject({ url: '/sponsored' })).json()).toEqual({ listings: [] });
  });

  it('GET /tiles/style.json serves the empty mock style without a key', async () => {
    const { app } = testApp();
    const style = (await app.inject({ url: '/tiles/style.json' })).json();
    expect(style.version).toBe(8);
    expect(style.layers[0].type).toBe('background');
  });

  it('rate-limits per device using config', async () => {
    const { app } = testApp({ config: { rateLimits: { perDevice: { traffic: 2 } } } });
    const hit = () => app.inject({ url: '/traffic?bbox=0,0,1,1', headers: { 'x-device-id': 'd1' } });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(429);
  });
});
