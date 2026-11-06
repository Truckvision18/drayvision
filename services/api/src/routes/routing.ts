import { randomUUID } from 'node:crypto';
import {
  IdSchema,
  primaryEntrance,
  RouteRequestSchema,
  RouteResponseSchema,
  SafetyValidateRequestSchema,
  TollEstimateSchema,
  TollRequestSchema,
  type CompleteTruckProfile,
  type LineCoordinates,
  type LngLat,
  type Route,
  type RouteResponse,
  type SafetyValidateResponse,
  type TollEstimate,
} from '@drayvision/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveAccount } from '../auth.js';
import { meteredCall, stableKey } from '../cache/metered.js';
import type { AppContext } from '../context.js';
import { HttpError, NotFoundError } from '../errors.js';
import { requireCompleteProfile } from '../profiles/guard.js';
import { RIGHTS_REGISTRY_VERSION } from '../rights/registry.js';
import { validateRoute } from '../safety/validate.js';
import { parseBody } from './schemas.js';

/**
 * Everything that depends on a truck profile: routes, tolls, safety checks. Each requires a
 * COMPLETE profile owned by the caller (requireCompleteProfile) and records the exact profile
 * version it used. Cache keys include that version, so editing a profile can never serve a
 * route or toll computed for the old truck.
 */
export function registerRoutingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, providers, cache, data } = ctx;
  const deps = { cache, meter: ctx.meter, config };

  async function resolveDestination(body: z.output<typeof RouteRequestSchema>): Promise<{ point: LngLat; facilityId: string | null }> {
    if (body.destination_coords) return { point: body.destination_coords, facilityId: null };
    const id = body.destination_facility_id!;
    const facility = await ctx.repo.facility(id);
    if (!facility) throw new NotFoundError(`Facility ${id} not found`);
    const entrance = primaryEntrance(facility);
    // Never fall back to the street address: trucks are routed to a known truck entrance or not at all.
    if (!entrance) throw new HttpError(422, 'FACILITY_NO_TRUCK_ENTRANCE', `${facility.name} has no truck entrance on file yet, so DrayVision can't route a truck there.`);
    return { point: entrance.coords, facilityId: facility.id };
  }

  /** Toll estimate for a geometry under one exact profile version (metered + cached). */
  async function tollEstimate(geometry: LineCoordinates, profile: CompleteTruckProfile, accountId: string, routeId: string | null): Promise<TollEstimate> {
    const key = stableKey({ a: accountId, g: geometry, p: profile.id, v: profile.version });
    const r = await meteredCall(deps, { provider: 'tolls', rightsId: providers.tolls.rightsId, key }, async () => {
      const est = await providers.tolls.estimate(geometry, profile);
      return TollEstimateSchema.parse({
        ...est,
        toll_estimate_id: randomUUID(),
        route_id: routeId,
        currency: 'USD',
        is_estimate: true,
        computed_at: ctx.now().toISOString(),
        cached: false,
        truck_profile_id: profile.id,
        truck_profile_version: profile.version,
      });
    });
    const estimate = { ...r.value, cached: r.cached };
    // Retrievable by id (GET /tolls/:id) for as long as the toll cache keeps it.
    await cache.set(`toll-estimate:${accountId}:${estimate.toll_estimate_id}`, JSON.stringify(estimate), config.cache.ttlSeconds.tolls).catch(() => undefined);
    return estimate;
  }

  // ---- POST /route ---------------------------------------------------------------------------
  app.post('/route', async (req): Promise<RouteResponse> => {
    const body = parseBody(RouteRequestSchema, req.body);
    const { accountId, profile } = await requireCompleteProfile(req, ctx, body.truck_profile_id);
    const destination = await resolveDestination(body);
    const departure = new Date(body.departure_time);

    const cacheKey = `route:${stableKey({
      a: accountId,
      p: profile.id,
      v: profile.version, // ← an edited profile never matches an old entry
      o: body.origin,
      d: destination.point,
      b: Math.floor(departure.getTime() / 1000 / config.routing.departureBucketSeconds),
      t: body.include_tolls,
      g: data.routingGraphVersion,
      r: data.restrictionsVersion,
    })}`;
    const hit = await cache.get(cacheKey).catch(() => null);
    if (hit) return RouteResponseSchema.parse(JSON.parse(hit));

    const engineRoutes = await providers.routing.route({ origin: body.origin, destination: destination.point, profile });
    const now = ctx.now();
    const all: Route[] = [];
    for (const er of engineRoutes) {
      const route_id = randomUUID();
      const toll = body.include_tolls ? await tollEstimate(er.geometry, profile, accountId, route_id) : null;
      all.push({
        route_id,
        origin: body.origin,
        destination: destination.point,
        destination_facility_id: destination.facilityId,
        geometry: er.geometry,
        maneuvers: er.maneuvers,
        distance_m: er.distance_m,
        duration_s: er.duration_s,
        departure_time: departure.toISOString(),
        toll_estimate_id: toll?.toll_estimate_id ?? null,
        safety_result: validateRoute(er.geometry, profile, data.restrictions, config.safety, now),
        data_versions: {
          routing_graph: er.graph_version,
          restrictions: data.restrictionsVersion,
          rights_registry: RIGHTS_REGISTRY_VERSION,
          truck_profile_id: profile.id,
          truck_profile_version: profile.version,
        },
        computed_at: now.toISOString(),
      });
    }
    const navigable = config.safety.blockOnFail ? all.filter((r) => r.safety_result.status !== 'FAIL') : all;
    const response: RouteResponse = {
      routes: navigable,
      rejected: all.filter((r) => !navigable.includes(r)).map((r) => ({ route_id: r.route_id, safety_result: r.safety_result })),
    };
    await cache.set(cacheKey, JSON.stringify(response), config.cache.ttlSeconds.route).catch(() => undefined);
    return response;
  });

  // ---- POST /tolls, GET /tolls/:id -----------------------------------------------------------
  app.post('/tolls', async (req) => {
    const body = parseBody(TollRequestSchema, req.body);
    const { accountId, profile } = await requireCompleteProfile(req, ctx, body.truck_profile_id);
    return tollEstimate(body.geometry as LineCoordinates, profile, accountId, body.route_id ?? null);
  });

  app.get('/tolls/:id', async (req) => {
    const accountId = resolveAccount(req, config.auth);
    const { id } = parseBody(z.object({ id: IdSchema }), req.params);
    const hit = await cache.get(`toll-estimate:${accountId}:${id}`).catch(() => null);
    if (!hit) throw new NotFoundError(`Toll estimate ${id} not found or expired`);
    return TollEstimateSchema.parse(JSON.parse(hit));
  });

  // ---- POST /safety/validate -----------------------------------------------------------------
  app.post('/safety/validate', async (req): Promise<SafetyValidateResponse> => {
    const body = parseBody(SafetyValidateRequestSchema, req.body);
    const { profile } = await requireCompleteProfile(req, ctx, body.truck_profile_id);
    return {
      safety_result: validateRoute(body.geometry as LineCoordinates, profile, data.restrictions, config.safety, ctx.now()),
      data_versions: {
        restrictions: data.restrictionsVersion,
        rights_registry: RIGHTS_REGISTRY_VERSION,
        truck_profile_id: profile.id,
        truck_profile_version: profile.version,
      },
    };
  });
}
