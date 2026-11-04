import type { IsoDateTime, LineCoordinates, LngLat } from './geo.js';
import type { Hazard } from './hazard.js';
import type { TollEstimate } from './toll.js';

export interface Maneuver {
  instruction: string;
  /** Valhalla maneuver type code or our own enum later (Phase 4). */
  type: string;
  distanceM: number;
  durationS: number;
  location: LngLat;
  streetNames: string[];
}

export interface RouteLeg {
  distanceM: number;
  durationS: number;
  maneuvers: Maneuver[];
}

/** Output of the safety validation layer (Phase 5). */
export interface RouteValidation {
  status: 'pass' | 'warn' | 'fail' | 'unvalidated';
  violations: Array<{ hazardId: string; reason: string }>;
  warnings: Array<{ hazardId: string; reason: string }>;
  /** Restriction dataset version the route was validated against. */
  restrictionsVersion: string;
  validatedAt: IsoDateTime;
}

export interface Route {
  id: string;
  profileId: string;
  origin: LngLat;
  destination: LngLat;
  geometry: LineCoordinates;
  distanceM: number;
  durationS: number;
  legs: RouteLeg[];
  hazards: Hazard[];
  validation: RouteValidation;
  tolls?: TollEstimate;
  /** Routing graph version (OSM extract date) the route was computed on. */
  graphVersion: string;
}
