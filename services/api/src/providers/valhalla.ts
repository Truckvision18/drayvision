import { randomUUID } from 'node:crypto';
import type { Maneuver, ManeuverType } from '@drayvision/shared';
import type { AppConfig } from '../../config/index.js';
import { decodePolyline } from './polyline.js';
import { UpstreamError, type RawRoute, type RouteRequest, type RoutingProvider } from './types.js';

interface ValhallaManeuver {
  type: number;
  instruction: string;
  verbal_pre_transition_instruction?: string;
  length: number; // km (we always request units=kilometers)
  time: number; // s
  begin_shape_index: number;
  end_shape_index: number;
  street_names?: string[];
}
interface ValhallaLeg {
  shape: string;
  summary: { length: number; time: number };
  maneuvers: ValhallaManeuver[];
}
interface ValhallaTrip {
  legs: ValhallaLeg[];
  summary: { length: number; time: number };
}
interface ValhallaError {
  error_code?: number;
  error?: string;
  status_code?: number;
}

/** Valhalla error codes that mean "no truck-legal route", not "the router is broken". */
const NO_ROUTE_CODES = new Set([
  154, // path distance exceeds the service limit
  170, // locations are in unconnected regions
  171, // no suitable edges near location
  442, // no path could be found for input
  443, // exact route match algorithm failed
]);

/** The request was valid but no truck-legal route exists (or a point is off the network). */
export class NoRouteError extends Error {
  readonly statusCode = 422;
  constructor(
    readonly valhallaCode: number | undefined,
    detail: string,
  ) {
    super(`No truck-legal route found: ${detail}`);
  }
}

// https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
const TYPE_MAP: Record<number, ManeuverType> = {
  1: 'depart',
  2: 'depart',
  3: 'depart',
  4: 'arrive',
  5: 'arrive',
  6: 'arrive',
  7: 'continue',
  8: 'continue',
  9: 'slight-right',
  10: 'right',
  11: 'sharp-right',
  12: 'uturn',
  13: 'uturn',
  14: 'sharp-left',
  15: 'left',
  16: 'slight-left',
  17: 'ramp',
  18: 'ramp',
  19: 'ramp',
  20: 'exit-right',
  21: 'exit-left',
  22: 'keep-straight',
  23: 'keep-right',
  24: 'keep-left',
  25: 'merge',
  26: 'roundabout-enter',
  27: 'roundabout-exit',
  28: 'ferry',
  29: 'ferry',
  37: 'merge',
  38: 'merge',
};

export const mapManeuverType = (code: number): ManeuverType => TYPE_MAP[code] ?? 'other';

export interface ValhallaOptions {
  baseUrl: string;
  timeoutMs: number;
  alternates: number;
  truckCosting: AppConfig['routing']['truckCosting'];
  /** OSM extract date from build-tiles.sh (data-version.json); "not-built" if absent. */
  graphVersion: string;
  fetchImpl?: typeof fetch;
}

/** Self-hosted Valhalla (Phase 4). No key and not metered, so it skips meteredCall. */
export class ValhallaRouting implements RoutingProvider {
  readonly name = 'valhalla';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ValhallaOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Map our TruckProfile + configured preferences onto Valhalla truck costing (metres / tonnes). */
  static costingOptions(p: RouteRequest['profile'], prefs: AppConfig['routing']['truckCosting']): Record<string, unknown> {
    return {
      truck: {
        height: p.heightM,
        width: p.widthM,
        length: p.lengthM,
        weight: p.grossWeightKg / 1000,
        ...(p.axleLoadKg !== undefined ? { axle_load: p.axleLoadKg / 1000 } : {}),
        axle_count: p.axleCount,
        hazmat: p.hazmat.length > 0,
        use_highways: prefs.useHighways,
        use_tolls: prefs.useTolls,
        use_living_streets: prefs.useLivingStreets,
        use_tracks: prefs.useTracks,
        ...(prefs.topSpeedKph !== null ? { top_speed: prefs.topSpeedKph } : {}),
      },
    };
  }

  async route(req: RouteRequest): Promise<RawRoute[]> {
    const body = {
      locations: [
        { lat: req.origin.lat, lon: req.origin.lng },
        { lat: req.destination.lat, lon: req.destination.lng },
      ],
      costing: 'truck',
      costing_options: ValhallaRouting.costingOptions(req.profile, this.opts.truckCosting),
      units: 'kilometers',
      language: 'en-US',
      ...(this.opts.alternates > 0 ? { alternates: this.opts.alternates } : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (err) {
      throw new UpstreamError('routing engine', 502, err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ValhallaError;
      if (res.status === 400 && err.error_code !== undefined && NO_ROUTE_CODES.has(err.error_code)) {
        throw new NoRouteError(err.error_code, err.error ?? 'unknown');
      }
      throw new UpstreamError('routing engine', 502, `HTTP ${res.status} ${err.error ?? ''}`.trim());
    }

    const json = (await res.json()) as { trip: ValhallaTrip; alternates?: Array<{ trip: ValhallaTrip }> };
    const trips = [json.trip, ...(json.alternates ?? []).map((a) => a.trip)];
    return trips.map((trip) => this.toRoute(trip, req));
  }

  private toRoute(trip: ValhallaTrip, req: RouteRequest): RawRoute {
    const geometry: Array<[number, number]> = [];
    const legs = trip.legs.map((leg) => {
      const shape = decodePolyline(leg.shape, 6);
      // Shape indices are per leg; offset them into the concatenated route geometry.
      const offset = geometry.length;
      geometry.push(...shape);
      const maneuvers: Maneuver[] = leg.maneuvers.map((m) => {
        const pt = shape[m.begin_shape_index] ?? shape[0] ?? [req.origin.lng, req.origin.lat];
        return {
          instruction: m.instruction,
          verbalInstruction: m.verbal_pre_transition_instruction,
          type: mapManeuverType(m.type),
          distanceM: m.length * 1000,
          durationS: m.time,
          location: { lng: pt[0], lat: pt[1] },
          streetNames: m.street_names ?? [],
          beginShapeIndex: offset + m.begin_shape_index,
          endShapeIndex: offset + m.end_shape_index,
        };
      });
      return { distanceM: leg.summary.length * 1000, durationS: leg.summary.time, maneuvers };
    });
    return {
      id: randomUUID(),
      profileId: req.profile.id,
      origin: req.origin,
      destination: req.destination,
      geometry,
      distanceM: trip.summary.length * 1000,
      durationS: trip.summary.time,
      legs,
      graphVersion: this.opts.graphVersion,
    };
  }

  async status(): Promise<{ up: boolean; graphVersion: string | null }> {
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}/status`, { signal: AbortSignal.timeout(this.opts.timeoutMs) });
      if (!res.ok) return { up: false, graphVersion: null };
      const json = (await res.json()) as { tileset_last_modified?: number };
      // Prefer the dated extract recorded by build-tiles.sh; fall back to the tileset mtime.
      if (this.opts.graphVersion !== 'not-built') return { up: true, graphVersion: this.opts.graphVersion };
      const gv = json.tileset_last_modified ? new Date(json.tileset_last_modified * 1000).toISOString() : null;
      return { up: true, graphVersion: gv };
    } catch {
      return { up: false, graphVersion: null };
    }
  }
}
