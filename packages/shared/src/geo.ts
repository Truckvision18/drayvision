/** WGS84 coordinate. Longitude first, matching GeoJSON ordering. */
export interface LngLat {
  lng: number;
  lat: number;
}

/** GeoJSON-style LineString coordinates: [lng, lat][] */
export type LineCoordinates = ReadonlyArray<readonly [number, number]>;

/** ISO-8601 date-time string. */
export type IsoDateTime = string;

/** Where a piece of data came from, and on what terms. Required on anything safety-relevant. */
export interface Provenance {
  /** e.g. "NYSDOT bridge clearance inventory", "field-verified", "osm" */
  source: string;
  /** Dataset version or retrieval date of the source. */
  sourceVersion: string;
  retrievedAt: IsoDateTime;
  /** Who verified the record, and how. Absent = unverified. */
  verifiedBy?: string;
  verifiedAt?: IsoDateTime;
  /** Key into the rights registry (services/api/src/rights). */
  rightsId: string;
}
