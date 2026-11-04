import { randomUUID } from 'node:crypto';
import type { Maneuver } from '@drayvision/shared';
import { decodePolyline } from './polyline.js';
import type { RawRoute, RouteRequest, RoutingProvider } from './types.js';

interface ValhallaManeuver {
  instruction: string;
  type: number;
  length: number; // km
  time: number; // s
  begin_shape_index: number;
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

/** Self-hosted Valhalla (Phase 4). No key — not metered — but still cached by the route handler. */
export class ValhallaRouting implements RoutingProvider {
  readonly name = 'valhalla';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Map our TruckProfile onto Valhalla truck costing options (metres / metric tonnes). */
  static costingOptions(p: RouteRequest['profile']): Record<string, unknown> {
    return {
      truck: {
        height: p.heightM,
        width: p.widthM,
        length: p.lengthM,
        weight: p.grossWeightKg / 1000,
        ...(p.axleLoadKg !== undefined ? { axle_load: p.axleLoadKg / 1000 } : {}),
        axle_count: p.axleCount,
        hazmat: p.hazmat.length > 0,
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
      costing_options: ValhallaRouting.costingOptions(req.profile),
      units: 'kilometers',
      alternates: 2,
    };
    const res = await this.fetchImpl(`${this.baseUrl}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`valhalla /route ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { trip: ValhallaTrip; alternates?: Array<{ trip: ValhallaTrip }> };
    const { graphVersion } = await this.status();
    const trips = [json.trip, ...(json.alternates ?? []).map((a) => a.trip)];
    return trips.map((trip) => this.toRoute(trip, req, graphVersion ?? 'unknown'));
  }

  private toRoute(trip: ValhallaTrip, req: RouteRequest, graphVersion: string): RawRoute {
    const geometry: Array<[number, number]> = [];
    const legs = trip.legs.map((leg) => {
      const shape = decodePolyline(leg.shape, 6);
      geometry.push(...shape);
      const maneuvers: Maneuver[] = leg.maneuvers.map((m) => {
        const pt = shape[m.begin_shape_index] ?? shape[0] ?? [req.origin.lng, req.origin.lat];
        return {
          instruction: m.instruction,
          type: String(m.type),
          distanceM: m.length * 1000,
          durationS: m.time,
          location: { lng: pt[0], lat: pt[1] },
          streetNames: m.street_names ?? [],
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
      graphVersion,
    };
  }

  async status(): Promise<{ up: boolean; graphVersion: string | null }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/status`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return { up: false, graphVersion: null };
      const json = (await res.json()) as { tileset_last_modified?: number };
      const gv = json.tileset_last_modified ? new Date(json.tileset_last_modified * 1000).toISOString() : null;
      return { up: true, graphVersion: gv };
    } catch {
      return { up: false, graphVersion: null };
    }
  }
}
