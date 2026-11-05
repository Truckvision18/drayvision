import type { IsoDateTime, LineCoordinates, LngLat } from './geo.js';
import type { Hazard } from './hazard.js';
import type { TollEstimate } from './toll.js';

/**
 * Engine-independent maneuver kinds. The Valhalla adapter maps its numeric codes onto these;
 * anything we don't model yet becomes 'other' (the text instruction still applies).
 */
export type ManeuverType =
  | 'depart'
  | 'arrive'
  | 'continue'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn'
  | 'sharp-left'
  | 'left'
  | 'slight-left'
  | 'ramp'
  | 'exit-right'
  | 'exit-left'
  | 'keep-straight'
  | 'keep-right'
  | 'keep-left'
  | 'merge'
  | 'roundabout-enter'
  | 'roundabout-exit'
  | 'ferry'
  | 'other';

export interface Maneuver {
  /** Screen text, e.g. "Turn left onto Doremus Ave." */
  instruction: string;
  /** Text for voice guidance before the maneuver, when the engine provides it. */
  verbalInstruction?: string | undefined;
  type: ManeuverType;
  /** Length of road covered by this maneuver (from its start to the next maneuver). */
  distanceM: number;
  durationS: number;
  /** Where the maneuver happens. */
  location: LngLat;
  streetNames: string[];
  /** Index into Route.geometry where this maneuver begins / ends — used for progress tracking. */
  beginShapeIndex: number;
  endShapeIndex: number;
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
