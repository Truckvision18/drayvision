import { ApiErrorSchema, RouteResponseSchema } from '@drayvision/shared';
import { describe, expect, it, vi } from 'vitest';
import { mockRouting, mockTolls } from '../src/providers/mock.js';
import { auth, createProfile, DEPARTURE, destination, facility, hazard, noEntranceFacility, origin, OTHER_ACCOUNT, testApp } from './helpers.js';

type App = ReturnType<typeof testApp>['app'];
const routeReq = (app: App, body: object, account?: string) =>
  app.inject({ method: 'POST', url: '/route', headers: auth(account), payload: { origin, destination_coords: destination, departure_time: DEPARTURE, ...body } });

describe('POST /route — the truck profile gate', () => {
  it.each([
    ['height', { height_m: null }, ['height_m']],
    ['weight', { weight_kg: null }, ['weight_kg']],
    ['height and weight', { height_m: null, weight_kg: null }, ['height_m', 'weight_kg']],
    ['axles', { axle_count: null }, ['axle_count']],
    ['hazmat answer', { hazmat: { carrying: null, classes: [] } }, ['hazmat']],
  ])('rejects a profile missing %s with PROFILE_INCOMPLETE — and never calls the router', async (_label, missing, fields) => {
    const route = vi.fn(mockRouting.route);
    const { app } = testApp({ providers: { routing: { ...mockRouting, route } } });
    const p = await createProfile(app, missing);
    const res = await routeReq(app, { truck_profile_id: p.id });
    expect(res.statusCode).toBe(422);
    const body = ApiErrorSchema.parse(res.json());
    expect(body.error).toBe('PROFILE_INCOMPLETE');
    expect(body.missing_fields).toEqual(fields);
    expect(body.message).toMatch(/^Complete your truck profile/);
    expect(route).not.toHaveBeenCalled();
  });

  it('rejects a name-only draft profile, listing every missing field', async () => {
    const { app } = testApp();
    const draft = (await app.inject({ method: 'POST', url: '/profiles', headers: auth(), payload: { name: 'draft' } })).json();
    const body = (await routeReq(app, { truck_profile_id: draft.id })).json();
    expect(body.missing_fields).toEqual(['height_m', 'weight_kg', 'length_m', 'width_m', 'axle_count', 'hazmat']);
  });

  it('there is no way to route without a profile: inline dimensions are refused', async () => {
    const { app } = testApp();
    expect((await routeReq(app, {})).statusCode).toBe(400);
    const inline = await routeReq(app, { truck_profile_id: 'x', profile: { height_m: 4 } });
    expect(inline.statusCode).toBe(400);
  });

  it('404s for unknown profiles and for another account’s profile', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    expect((await routeReq(app, { truck_profile_id: 'nope' })).json().error).toBe('PROFILE_NOT_FOUND');
    expect((await routeReq(app, { truck_profile_id: p.id }, OTHER_ACCOUNT)).json().error).toBe('PROFILE_NOT_FOUND');
  });

  it('becomes routable as soon as the missing fields are filled in', async () => {
    const { app } = testApp();
    const p = await createProfile(app, { height_m: null });
    expect((await routeReq(app, { truck_profile_id: p.id })).statusCode).toBe(422);
    await app.inject({ method: 'PATCH', url: `/profiles/${p.id}`, headers: auth(), payload: { expected_version: 1, height_m: 4.11 } });
    const res = await routeReq(app, { truck_profile_id: p.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().routes[0].data_versions).toMatchObject({ truck_profile_id: p.id, truck_profile_version: 2 });
  });
});

describe('POST /route — results', () => {
  it('returns schema-valid routes stamped with every data version, incl. the exact profile version', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const body = RouteResponseSchema.parse((await routeReq(app, { truck_profile_id: p.id })).json());
    expect(body.routes[0]).toMatchObject({
      safety_result: { status: 'PASS' },
      departure_time: DEPARTURE,
      toll_estimate_id: null,
      data_versions: { truck_profile_id: p.id, truck_profile_version: 1, restrictions: 'test-restrictions-1', routing_graph: 'mock' },
    });
  });

  it('withholds a route under a low bridge for THIS truck, keeping it in `rejected`', async () => {
    const bridge = hazard({ id: 'bridge-1', type: 'LOW_CLEARANCE', value: 3.9, location: { lng: -74.0, lat: 40.705 } });
    const { app } = testApp({ restrictions: [bridge] });
    const p = await createProfile(app);
    const body = (await routeReq(app, { truck_profile_id: p.id })).json();
    expect(body.routes).toHaveLength(0);
    expect(body.rejected[0].safety_result.violations[0].hazard_id).toBe('bridge-1');
  });

  it('routes to a facility’s PRIMARY TRUCK ENTRANCE, not its street address', async () => {
    const route = vi.fn(mockRouting.route);
    const { app } = testApp({ providers: { routing: { ...mockRouting, route } } });
    const p = await createProfile(app);
    const res = await app.inject({
      method: 'POST',
      url: '/route',
      headers: auth(),
      payload: { origin, destination_facility_id: facility.id, truck_profile_id: p.id, departure_time: DEPARTURE },
    });
    expect(res.statusCode).toBe(200);
    expect(route.mock.calls[0]![0].destination).toEqual(facility.truck_entrances[0]!.coords);
    expect(res.json().routes[0].destination_facility_id).toBe(facility.id);
  });

  it('refuses a facility with no truck entrance on file (no street-address guess)', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const res = await app.inject({
      method: 'POST',
      url: '/route',
      headers: auth(),
      payload: { origin, destination_facility_id: noEntranceFacility.id, truck_profile_id: p.id, departure_time: DEPARTURE },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('FACILITY_NO_TRUCK_ENTRANCE');
  });

  it('requires exactly one destination form', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const both = await routeReq(app, { truck_profile_id: p.id, destination_facility_id: facility.id });
    expect(both.statusCode).toBe(400);
  });

  it('attaches a toll estimate id when tolls are requested, retrievable via GET /tolls/:id', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const r = (await routeReq(app, { truck_profile_id: p.id, include_tolls: true })).json().routes[0];
    expect(r.toll_estimate_id).toEqual(expect.any(String));
    const toll = (await app.inject({ url: `/tolls/${r.toll_estimate_id}`, headers: auth() })).json();
    expect(toll).toMatchObject({ route_id: r.route_id, transponders_applied: ['E_ZPASS'], truck_profile_version: 1 });
    expect((await app.inject({ url: `/tolls/${r.toll_estimate_id}`, headers: auth(OTHER_ACCOUNT) })).statusCode).toBe(404);
  });
});

describe('profile versioning invalidates cached routes', () => {
  it('serves a repeat request from cache, but an edit forces a fresh route under the new version', async () => {
    const route = vi.fn(mockRouting.route);
    const { app } = testApp({ providers: { routing: { ...mockRouting, route } } });
    const p = await createProfile(app);

    const first = (await routeReq(app, { truck_profile_id: p.id })).json();
    const again = (await routeReq(app, { truck_profile_id: p.id })).json();
    expect(route).toHaveBeenCalledTimes(1);
    expect(again.routes[0].route_id).toBe(first.routes[0].route_id); // cache hit

    // Driver swaps to a taller box: version 2.
    await app.inject({ method: 'PATCH', url: `/profiles/${p.id}`, headers: auth(), payload: { expected_version: 1, height_m: 4.27 } });

    const after = (await routeReq(app, { truck_profile_id: p.id })).json();
    expect(route).toHaveBeenCalledTimes(2); // old cached route NOT served
    expect(after.routes[0].route_id).not.toBe(first.routes[0].route_id);
    expect(after.routes[0].data_versions.truck_profile_version).toBe(2);
    expect(route.mock.calls[1]![0].profile.height_m).toBe(4.27);
  });

  it('an edit that makes the old route unsafe is caught, not served from cache', async () => {
    // Bridge at 4.5 m. A 4.11 m box needs 4.26 m → offered (inside the warning band, so WARN).
    // After the edit to a 4.5 m box it needs 4.65 m → FAIL. The cached v1 route must not be reused.
    const bridge = hazard({ id: 'b', type: 'LOW_CLEARANCE', value: 4.5, location: { lng: -74.0, lat: 40.705 } });
    const { app } = testApp({ restrictions: [bridge] });
    const p = await createProfile(app);
    expect((await routeReq(app, { truck_profile_id: p.id })).json().routes).toHaveLength(1);
    await app.inject({ method: 'PATCH', url: `/profiles/${p.id}`, headers: auth(), payload: { expected_version: 1, height_m: 4.5 } });
    const after = (await routeReq(app, { truck_profile_id: p.id })).json();
    expect(after.routes).toHaveLength(0);
    expect(after.rejected[0].safety_result.status).toBe('FAIL');
  });

  it('toll estimates are keyed by profile version too', async () => {
    const estimate = vi.fn(mockTolls.estimate);
    const { app } = testApp({ providers: { tolls: { ...mockTolls, estimate } } });
    const p = await createProfile(app);
    const payload = { geometry: [[-74, 40.7], [-74, 40.71]], truck_profile_id: p.id, departure_time: DEPARTURE };
    const a = (await app.inject({ method: 'POST', url: '/tolls', headers: auth(), payload })).json();
    const b = (await app.inject({ method: 'POST', url: '/tolls', headers: auth(), payload })).json();
    expect([a.cached, b.cached]).toEqual([false, true]);
    await app.inject({ method: 'PATCH', url: `/profiles/${p.id}`, headers: auth(), payload: { expected_version: 1, axle_count: 6 } });
    const c = (await app.inject({ method: 'POST', url: '/tolls', headers: auth(), payload })).json();
    expect(c).toMatchObject({ cached: false, truck_profile_version: 2 });
    expect(estimate).toHaveBeenCalledTimes(2);
  });
});

describe('tolls and safety require a complete profile too', () => {
  it('POST /tolls rejects an incomplete profile', async () => {
    const { app } = testApp();
    const p = await createProfile(app, { weight_kg: null });
    const res = await app.inject({
      method: 'POST',
      url: '/tolls',
      headers: auth(),
      payload: { geometry: [[-74, 40.7], [-74, 40.71]], truck_profile_id: p.id, departure_time: DEPARTURE },
    });
    expect(res.json()).toMatchObject({ error: 'PROFILE_INCOMPLETE', missing_fields: ['weight_kg'] });
  });

  it('POST /safety/validate rejects an incomplete profile and validates a complete one', async () => {
    const bridge = hazard({ id: 'b', type: 'LOW_CLEARANCE', value: 3.9, location: { lng: -74.0, lat: 40.705 } });
    const { app } = testApp({ restrictions: [bridge] });
    const geometry = [[-74, 40.7], [-74, 40.71]];
    const draft = await createProfile(app, { height_m: null });
    const bad = await app.inject({ method: 'POST', url: '/safety/validate', headers: auth(), payload: { geometry, truck_profile_id: draft.id } });
    expect(bad.json().error).toBe('PROFILE_INCOMPLETE');
    const p = await createProfile(app);
    const ok = (await app.inject({ method: 'POST', url: '/safety/validate', headers: auth(), payload: { geometry, truck_profile_id: p.id } })).json();
    expect(ok).toMatchObject({ safety_result: { status: 'FAIL' }, data_versions: { truck_profile_id: p.id, truck_profile_version: 1 } });
  });
});

describe('feeds and facilities', () => {
  it('GET /traffic requires a bbox', async () => {
    const { app } = testApp();
    expect((await app.inject({ url: '/traffic' })).json().error).toBe('BAD_REQUEST');
    expect((await app.inject({ url: '/traffic?bbox=-74.1,40.6,-73.9,40.8' })).json().events).toHaveLength(1);
  });

  it('GET /cameras rewrites image URLs to our API, never upstream', async () => {
    const { app } = testApp();
    const body = (await app.inject({ url: '/cameras?bbox=-74.1,40.6,-73.9,40.8', headers: { host: '10.0.2.2:8080' } })).json();
    expect(body.cameras[0].image_url).toBe('http://10.0.2.2:8080/cameras/mock-cam-1/image');
    expect((await app.inject({ url: '/cameras/mock-cam-1/image' })).headers['content-type']).toBe('image/png');
  });

  it('GET /facilities (bbox over truck entrances), /facilities/:id, /ports', async () => {
    const { app } = testApp();
    expect((await app.inject({ url: '/facilities' })).json().facilities).toHaveLength(2);
    expect((await app.inject({ url: '/facilities?bbox=-74.2,40.6,-74.0,40.7' })).json().facilities.map((f: { id: string }) => f.id)).toEqual(['fac-1']);
    expect((await app.inject({ url: '/facilities/nope' })).json().error).toBe('NOT_FOUND');
    expect((await app.inject({ url: '/ports' })).json().ports[0]).toMatchObject({ id: 'fac-1', latest_wait: null });
  });

  it('unknown paths and malformed JSON use the ApiError shape', async () => {
    const { app } = testApp();
    expect(ApiErrorSchema.parse((await app.inject({ url: '/nope' })).json()).error).toBe('NOT_FOUND');
    const bad = await app.inject({ method: 'POST', url: '/profiles', headers: { ...auth(), 'content-type': 'application/json' }, payload: '{' });
    expect(ApiErrorSchema.parse(bad.json()).error).toBe('BAD_REQUEST');
  });

  it('rate-limits per device using config', async () => {
    const { app } = testApp({ config: { rateLimits: { perDevice: { traffic: 2 } } } });
    const hit = () => app.inject({ url: '/traffic?bbox=0,0,1,1', headers: { 'x-device-id': 'd1' } });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).json()).toMatchObject({ error: 'RATE_LIMITED' });
  });
});
