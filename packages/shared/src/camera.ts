import type { IsoDateTime, LngLat } from './geo.js';

export interface Camera {
  id: string;
  name: string;
  location: LngLat;
  /** Compass heading the camera faces, degrees, if known. */
  headingDeg?: number;
  /** Feed provider key, e.g. "ny511". */
  provider: string;
  /** Served via our API (never the upstream URL) so we can cache + honour rights. */
  imageUrl?: string;
  lastUpdated?: IsoDateTime;
  /** Rights registry id that governs how this image may be displayed. */
  rightsId: string;
  attribution: string;
}
