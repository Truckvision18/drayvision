import type { LngLat, Provenance } from './geo.js';

export type HazardKind =
  | 'low-clearance'
  | 'weight-limit'
  | 'length-limit'
  | 'width-limit'
  | 'truck-prohibited'
  | 'hazmat-prohibited'
  | 'parkway'
  | 'tunnel'
  | 'sharp-turn'
  | 'construction'
  | 'incident';

export type HazardSeverity = 'info' | 'caution' | 'blocking';

export interface Hazard {
  id: string;
  kind: HazardKind;
  severity: HazardSeverity;
  location: LngLat;
  /** Numeric limit in SI units where applicable (metres or kg). */
  limit?: number;
  description: string;
  /** Distance along route in metres, when attached to a route. */
  distanceAlongRouteM?: number;
  provenance: Provenance;
}
