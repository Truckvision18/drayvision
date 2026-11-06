/**
 * Contract tests: every API payload — for this phase and the later ones (routing, tolls, traffic,
 * cameras, facilities / ports, sponsored, health, errors) — validates against the shared schemas
 * in @drayvision/shared. If a handler drifts from the shared types, this fails.
 */
import {
  ApiErrorSchema,
  CamerasResponseSchema,
  FacilitiesResponseSchema,
  FacilitySchema,
  HealthResponseSchema,
  MapUsageResponseSchema,
  RestrictionsResponseSchema,
  TileConfigSchema,
  PortsResponseSchema,
  ProfilesResponseSchema,
  RouteResponseSchema,
  SafetyValidateResponseSchema,
  SponsoredResponseSchema,
  TollEstimateSchema,
  TrafficResponseSchema,
  TruckProfileSchema,
  type CompleteTruckProfile,
  EngineRouteSchema,
  type TollEstimate,
  type TrafficEvent,
} from '@drayvision/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { EngineRoute, EngineRouteRequest, TollProvider, TrafficProvider } from '../src/providers/types.js';
import { auth, createProfile, DEPARTURE, destination, facility, hazard, origin, testApp } from './helpers.js';

const geometry = [
  [-74, 40.7],
  [-74, 40.71],
];

async function setup() {
  const bridge = hazard({ id: 'b', type: 'LOW_CLEARANCE', value: 4.4, location: { lng: -74, lat: 40.705 } });
  const { app } = testApp({ restrictions: [bridge] });
  const profile = await createProfile(app);
  return { app, profile };
}

const cases: Array<[string, (a: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, z.ZodTypeAny]> = [
  ['GET /health', ({ app }) => app.inject({ url: '/health' }).then((r) => r.json()), HealthResponseSchema],
  ['GET /profiles (Phase: profiles)', ({ app }) => app.inject({ url: '/profiles', headers: auth() }).then((r) => r.json()), ProfilesResponseSchema],
  ['GET /profiles/:id', ({ app, profile }) => app.inject({ url: `/profiles/${profile.id}`, headers: auth() }).then((r) => r.json()), TruckProfileSchema],
  [
    'GET /profiles/:id/versions/:v',
    ({ app, profile }) => app.inject({ url: `/profiles/${profile.id}/versions/1`, headers: auth() }).then((r) => r.json()),
    TruckProfileSchema,
  ],
  [
    'POST /route (Phase 4/5)',
    ({ app, profile }) =>
      app
        .inject({ method: 'POST', url: '/route', headers: auth(), payload: { origin, destination_coords: destination, truck_profile_id: profile.id, departure_time: DEPARTURE, include_tolls: true } })
        .then((r) => r.json()),
    RouteResponseSchema,
  ],
  [
    'POST /safety/validate (Phase 5)',
    ({ app, profile }) => app.inject({ method: 'POST', url: '/safety/validate', headers: auth(), payload: { geometry, truck_profile_id: profile.id } }).then((r) => r.json()),
    SafetyValidateResponseSchema,
  ],
  [
    'POST /tolls (Phase 6)',
    ({ app, profile }) => app.inject({ method: 'POST', url: '/tolls', headers: auth(), payload: { geometry, truck_profile_id: profile.id, departure_time: DEPARTURE } }).then((r) => r.json()),
    TollEstimateSchema,
  ],
  ['GET /traffic (Phase 7)', ({ app }) => app.inject({ url: '/traffic?bbox=-74.2,40.6,-73.9,40.8' }).then((r) => r.json()), TrafficResponseSchema],
  ['GET /cameras (Phase 8)', ({ app }) => app.inject({ url: '/cameras?bbox=-74.2,40.6,-73.9,40.8' }).then((r) => r.json()), CamerasResponseSchema],
  ['GET /facilities (Phase 9/10)', ({ app }) => app.inject({ url: '/facilities' }).then((r) => r.json()), FacilitiesResponseSchema],
  ['GET /facilities/:id', ({ app }) => app.inject({ url: `/facilities/${facility.id}` }).then((r) => r.json()), FacilitySchema],
  ['GET /ports', ({ app }) => app.inject({ url: '/ports' }).then((r) => r.json()), PortsResponseSchema],
  ['GET /sponsored', ({ app }) => app.inject({ url: '/sponsored' }).then((r) => r.json()), SponsoredResponseSchema],
  ['GET /tiles/config (map)', ({ app }) => app.inject({ url: '/tiles/config' }).then((r) => r.json()), TileConfigSchema],
  ['GET /restrictions (hazards layer)', ({ app }) => app.inject({ url: '/restrictions?bbox=-75,40,-73,41' }).then((r) => r.json()), RestrictionsResponseSchema],
  ['GET /usage/maps/me (debug panel)', ({ app }) => app.inject({ url: '/usage/maps/me', headers: { 'x-device-id': 'd1' } }).then((r) => r.json()), MapUsageResponseSchema],
  ['GET /usage/maps (reconciliation)', ({ app }) => app.inject({ url: '/usage/maps' }).then((r) => r.json()), MapUsageResponseSchema],
  // Error payloads are part of the contract too.
  ['PROFILE_INCOMPLETE error', async ({ app }) => {
    const draft = (await app.inject({ method: 'POST', url: '/profiles', headers: auth(), payload: { name: 'draft' } })).json();
    return (await app.inject({ method: 'POST', url: '/route', headers: auth(), payload: { origin, destination_coords: destination, truck_profile_id: draft.id, departure_time: DEPARTURE } })).json();
  }, ApiErrorSchema],
  ['VERSION_CONFLICT error', ({ app, profile }) => app.inject({ method: 'PATCH', url: `/profiles/${profile.id}`, headers: auth(), payload: { expected_version: 9, name: 'x' } }).then((r) => r.json()), ApiErrorSchema],
  ['NOT_IMPLEMENTED error (live provider shell)', () => {
    const { app } = testApp({ config: { auth: { mode: 'token' } } });
    return app.inject({ url: '/profiles', headers: auth() }).then((r) => r.json());
  }, ApiErrorSchema],
];

describe('every API payload validates against the shared schemas', () => {
  it.each(cases)('%s', async (_name, call, schema) => {
    const payload = await call(await setup());
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    expect(parsed.success).toBe(true);
  });
});

describe('compile-time: provider and handler types ARE the shared types (checked by `npm run typecheck`)', () => {
  it('routing engines only ever receive a complete profile', () => {
    expectTypeOf<EngineRouteRequest['profile']>().toEqualTypeOf<CompleteTruckProfile>();
    expectTypeOf<CompleteTruckProfile['height_m']>().toEqualTypeOf<number>();
    expectTypeOf<CompleteTruckProfile['weight_kg']>().toEqualTypeOf<number>();
  });

  it('engine output uses the shared Maneuver shape', () => {
    expectTypeOf<EngineRoute>().toEqualTypeOf<z.infer<typeof EngineRouteSchema>>();
  });

  it('toll and traffic providers produce shared types', () => {
    expectTypeOf<Parameters<TollProvider['estimate']>[1]>().toEqualTypeOf<CompleteTruckProfile>();
    expectTypeOf<Awaited<ReturnType<TollProvider['estimate']>>['transponders_applied']>().toEqualTypeOf<TollEstimate['transponders_applied']>();
    expectTypeOf<Awaited<ReturnType<TrafficProvider['events']>>>().toEqualTypeOf<TrafficEvent[]>();
  });
});
