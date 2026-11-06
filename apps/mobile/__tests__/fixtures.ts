import { RouteSchema, TruckProfileSchema, type Route, type RouteResponse, type SafetyStatus, type TruckProfile } from '@drayvision/shared';

/** A complete 40' container rig, as the server would return it. Validated against the shared schema. */
export function profile(over: Partial<TruckProfile> = {}): TruckProfile {
  return TruckProfileSchema.parse({
    id: 'truck-1',
    account_id: 'dev-device-account',
    version: 1,
    name: 'Volvo + 40ft chassis',
    height_m: 4.11,
    weight_kg: 36_287.39, // 80,000 lb
    length_m: 21.03,
    width_m: 2.59,
    axle_count: 5,
    hazmat: { carrying: false, classes: [] },
    transponders: [{ network: 'E_ZPASS', label: null }],
    home_terminal: null,
    is_default: true,
    created_at: '2026-11-06T12:00:00.000Z',
    updated_at: '2026-11-06T12:00:00.000Z',
    ...over,
  });
}

/**
 * L-shaped test route near Null Island: depart north ~1112 m, turn right, east ~1112 m, arrive.
 *   (0,0) ──north──▶ (0,0.01) ──east──▶ (0.01,0.01)
 * Computed for `truck` at `version` (defaults: truck-1 v1). Validated against the shared schema.
 */
export function lRoute(id = 'r1', status: SafetyStatus = 'PASS', truck: Pick<TruckProfile, 'id' | 'version'> = { id: 'truck-1', version: 1 }): Route {
  return RouteSchema.parse({
    route_id: id,
    origin: { lng: 0, lat: 0 },
    destination: { lng: 0.01, lat: 0.01 },
    destination_facility_id: null,
    geometry: [
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
    ],
    maneuvers: [
      { instruction: 'Drive north.', verbal_instruction: null, type: 'depart', distance_m: 1112, duration_s: 100, location: { lng: 0, lat: 0 }, street_names: [], begin_shape_index: 0, end_shape_index: 1 },
      {
        instruction: 'Turn right onto Port St.',
        verbal_instruction: 'Turn right onto Port Street.',
        type: 'right',
        distance_m: 1112,
        duration_s: 100,
        location: { lng: 0, lat: 0.01 },
        street_names: ['Port St'],
        begin_shape_index: 1,
        end_shape_index: 2,
      },
      { instruction: 'Arrive.', verbal_instruction: null, type: 'arrive', distance_m: 0, duration_s: 0, location: { lng: 0.01, lat: 0.01 }, street_names: [], begin_shape_index: 2, end_shape_index: 2 },
    ],
    distance_m: 2224,
    duration_s: 200,
    departure_time: '2026-11-06T13:00:00.000Z',
    toll_estimate_id: null,
    safety_result: {
      status,
      hazards: [],
      violations: status === 'FAIL' ? [{ hazard_id: 'h', reason: 'fixture' }] : [],
      warnings: [],
      validated_at: '2026-11-06T13:00:00.000Z',
    },
    data_versions: { routing_graph: '2026-11-05', restrictions: 'rv1', rights_registry: 'rr1', truck_profile_id: truck.id, truck_profile_version: truck.version },
    computed_at: '2026-11-06T13:00:00.000Z',
  });
}

export const response = (...routes: Route[]): RouteResponse => ({ routes, rejected: [] });

/** Latitude offset for N metres north (≈ 111.2 km per degree). */
export const north = (m: number): number => m / 111_195;
