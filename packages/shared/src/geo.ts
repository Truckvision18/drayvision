import { z } from 'zod';

/** WGS84 coordinate. */
export const LngLatSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type LngLat = z.infer<typeof LngLatSchema>;

/** GeoJSON-style LineString coordinates: [lng, lat][] (longitude first). */
export const LineCoordinatesSchema = z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]));
export type LineCoordinates = ReadonlyArray<readonly [number, number]>;

/** ISO-8601 timestamp with offset, e.g. 2026-11-06T14:00:00Z. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = string;

export const IdSchema = z.string().min(1).max(128);

/**
 * Where a piece of data came from. Required on everything safety-relevant (hazards,
 * restrictions, entrances). `rights_id` keys into the rights registry (services/api/src/rights).
 */
export const SourceKindSchema = z.enum(['OFFICIAL', 'OSM', 'DRIVER_REPORT', 'ROUTING_ENGINE']);
export const SourceSchema = z.object({
  kind: SourceKindSchema,
  /** e.g. "NYSDOT bridge clearance inventory" */
  name: z.string().min(1),
  /** Dataset version or snapshot date of the source. */
  dataset_version: z.string().min(1),
  retrieved_at: IsoDateTimeSchema,
  rights_id: z.string().min(1),
});
export type Source = z.infer<typeof SourceSchema>;
