import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LineCoordinatesSchema, LngLatSchema } from './geo.js';
import { HazardSchema } from './hazard.js';
import { ProfileRefSchema } from './truck.js';

/** Engine-independent maneuver kinds; the Valhalla adapter maps its codes onto these. */
export const ManeuverTypeSchema = z.enum([
  'depart',
  'arrive',
  'continue',
  'slight-right',
  'right',
  'sharp-right',
  'uturn',
  'sharp-left',
  'left',
  'slight-left',
  'ramp',
  'exit-right',
  'exit-left',
  'keep-straight',
  'keep-right',
  'keep-left',
  'merge',
  'roundabout-enter',
  'roundabout-exit',
  'ferry',
  'other',
]);
export type ManeuverType = z.infer<typeof ManeuverTypeSchema>;

export const ManeuverSchema = z.object({
  /** Screen text, e.g. "Turn left onto Doremus Ave." */
  instruction: z.string(),
  /** Voice text before the maneuver, when the engine provides it. */
  verbal_instruction: z.string().nullable(),
  type: ManeuverTypeSchema,
  /** Road covered from this maneuver to the next. */
  distance_m: z.number().nonnegative(),
  duration_s: z.number().nonnegative(),
  location: LngLatSchema,
  street_names: z.array(z.string()),
  /** Indices into Route.geometry where this maneuver begins / ends (progress tracking). */
  begin_shape_index: z.number().int().nonnegative(),
  end_shape_index: z.number().int().nonnegative(),
});
export type Maneuver = z.infer<typeof ManeuverSchema>;

/**
 * What a routing engine adapter (Valhalla today) must return, before the API adds safety
 * validation and the route envelope. Any future engine adapter conforms to this.
 */
export const EngineRouteSchema = z.object({
  geometry: z.array(z.tuple([z.number(), z.number()])).min(2),
  maneuvers: z.array(ManeuverSchema).min(1),
  distance_m: z.number().nonnegative(),
  duration_s: z.number().nonnegative(),
  /** OSM extract date of the graph that produced it. */
  graph_version: z.string().min(1),
});
export type EngineRoute = z.infer<typeof EngineRouteSchema>;

/**
 * Request a truck route. Exactly one destination form:
 *  - `destination_facility_id` → routed to the facility's PRIMARY TRUCK ENTRANCE (not its street address)
 *  - `destination_coords`      → a raw point
 * `truck_profile_id` must name a COMPLETE profile owned by the caller; the server uses its
 * current version and records it on the route.
 */
export const RouteRequestSchema = z
  .object({
    origin: LngLatSchema,
    destination_facility_id: IdSchema.optional(),
    destination_coords: LngLatSchema.optional(),
    truck_profile_id: IdSchema,
    departure_time: IsoDateTimeSchema,
    include_tolls: z.boolean().default(false),
  })
  .strict()
  .refine((r) => (r.destination_facility_id === undefined) !== (r.destination_coords === undefined), {
    message: 'give exactly one of destination_facility_id or destination_coords',
  });
export type RouteRequest = z.input<typeof RouteRequestSchema>;

/** Output of the Phase 5 safety layer for one route. */
export const SafetyStatusSchema = z.enum(['PASS', 'WARN', 'FAIL']);
export type SafetyStatus = z.infer<typeof SafetyStatusSchema>;

const findingSchema = z.object({ hazard_id: IdSchema, reason: z.string() });

export const SafetyResultSchema = z.object({
  status: SafetyStatusSchema,
  /** Every hazard matched on the route, in route order, with `resolved` evaluated for this truck. */
  hazards: z.array(HazardSchema),
  violations: z.array(findingSchema),
  warnings: z.array(findingSchema),
  validated_at: IsoDateTimeSchema,
});
export type SafetyResult = z.infer<typeof SafetyResultSchema>;

/** Every dataset a route depends on, so any route can be reproduced and audited. */
export const DataVersionsSchema = ProfileRefSchema.extend({
  /** OSM extract date the routing graph was built from. */
  routing_graph: z.string().min(1),
  restrictions: z.string().min(1),
  rights_registry: z.string().min(1),
});
export type DataVersions = z.infer<typeof DataVersionsSchema>;

export const RouteSchema = z.object({
  route_id: IdSchema,
  origin: LngLatSchema,
  destination: LngLatSchema,
  destination_facility_id: IdSchema.nullable(),
  geometry: LineCoordinatesSchema.min(2),
  maneuvers: z.array(ManeuverSchema).min(1),
  distance_m: z.number().nonnegative(),
  duration_s: z.number().nonnegative(),
  departure_time: IsoDateTimeSchema,
  /** Set when tolls were requested; fetch via the tolls API. */
  toll_estimate_id: IdSchema.nullable(),
  safety_result: SafetyResultSchema,
  data_versions: DataVersionsSchema,
  computed_at: IsoDateTimeSchema,
});
export type Route = z.infer<typeof RouteSchema>;

export const RouteResponseSchema = z.object({
  /** Only routes whose safety_result is not FAIL. */
  routes: z.array(RouteSchema),
  /** Routes the safety layer refused, with why — never offered for navigation. */
  rejected: z.array(z.object({ route_id: IdSchema, safety_result: SafetyResultSchema })),
});
export type RouteResponse = z.infer<typeof RouteResponseSchema>;

/** POST /safety/validate — re-check a geometry for a profile (e.g. a cached route). */
export const SafetyValidateRequestSchema = z
  .object({
    geometry: LineCoordinatesSchema.min(2),
    truck_profile_id: IdSchema,
  })
  .strict();
export type SafetyValidateRequest = z.infer<typeof SafetyValidateRequestSchema>;

export const SafetyValidateResponseSchema = z.object({
  safety_result: SafetyResultSchema,
  data_versions: DataVersionsSchema.omit({ routing_graph: true }),
});
export type SafetyValidateResponse = z.infer<typeof SafetyValidateResponseSchema>;
