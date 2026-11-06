import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './geo.js';

/**
 * The map: one tile configuration served by the API (so the tile source can change without an
 * app release), the on-map layer stack, and map usage analytics.
 */

/**
 * On-map overlay layers, in z-order from bottom to top. The base map (roads etc.) is always
 * underneath; `route` sits just above it. Clients must draw in exactly this order.
 */
export const MAP_LAYER_ORDER = ['route', 'hazards', 'traffic', 'cameras', 'facilities', 'sponsored'] as const;
export const MapLayerIdSchema = z.enum(MAP_LAYER_ORDER);
export type MapLayerId = z.infer<typeof MapLayerIdSchema>;

/** Overlay layers a driver can switch on/off (the route itself is not toggleable). */
export const TOGGLEABLE_LAYERS = ['hazards', 'traffic', 'cameras', 'facilities', 'sponsored'] as const satisfies readonly MapLayerId[];
export type ToggleableLayer = (typeof TOGGLEABLE_LAYERS)[number];

/**
 * Empty marker layers the API injects into every style, in MAP_LAYER_ORDER, after the base
 * map. Each overlay is inserted *below* the anchor of the layer above it, so the stack order
 * is fixed no matter which layers are toggled on, or in what order they mount.
 */
export const layerAnchorId = (layer: MapLayerId | 'top'): string => `dv-anchor-${layer}`;

export const TileSourceSchema = z.enum(['maptiler', 'self-hosted', 'mock']);
export type TileSource = z.infer<typeof TileSourceSchema>;

/** proxy: tiles flow through our API (keys server-side). direct: the client calls the provider with a restricted client key. */
export const TileDeliverySchema = z.enum(['proxy', 'direct']);
export type TileDelivery = z.infer<typeof TileDeliverySchema>;

export const AttributionSchema = z.object({ text: z.string().min(1), url: z.string().url() });
export type Attribution = z.infer<typeof AttributionSchema>;

/** OSM attribution — required on every map we draw, whatever the tile source. */
export const OSM_ATTRIBUTION: Attribution = { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' };
export const MAPTILER_ATTRIBUTION: Attribution = { text: '© MapTiler', url: 'https://www.maptiler.com/copyright/' };

/** GET /tiles/config — fetched by the app at launch. */
export const TileConfigSchema = z.object({
  /** Changes whenever anything below changes; clients may cache by it. */
  config_version: z.string().min(1),
  source: TileSourceSchema,
  delivery: TileDeliverySchema,
  style_url: z.string().url(),
  /** True when the style carries the dv-anchor-* layers (our proxy injects them; a direct provider style doesn't). */
  layer_anchors: z.boolean(),
  /** Must be rendered on the map at all times and on anything exported or shared. */
  attribution: z.array(AttributionSchema).min(1),
  /** How the provider bills this integration: per map session, per request, or not at all (self-hosted). */
  billing_unit: z.enum(['session', 'request', 'none']),
  device_cache: z.object({
    /** Ambient (on-device, single-user) tile cache size. */
    ambient_cache_bytes: z.number().int().nonnegative(),
  }),
  prefetch: z.object({
    /** False when the source's terms forbid bulk download (e.g. MapTiler without a written agreement). */
    enabled: z.boolean(),
    corridor_buffer_m: z.number().positive(),
    /** Route length per offline pack: short chunks keep each (rectangular) pack hugging the corridor. */
    corridor_chunk_m: z.number().positive(),
    destination_radius_m: z.number().positive(),
    min_zoom: z.number().int().min(0).max(22),
    max_zoom: z.number().int().min(0).max(22),
    max_tiles_per_pack: z.number().int().positive(),
    max_packs: z.number().int().positive(),
  }),
  export: z.object({
    /** Whether a map image may be included in a shared/exported view (MapTiler: no). */
    snapshot_allowed: z.boolean(),
  }),
  session: z.object({
    /** A map session ends after this long, or this many requests (mirrors MapTiler's session rules). */
    max_duration_s: z.number().int().positive(),
    max_requests: z.number().int().positive(),
  }),
});
export type TileConfig = z.infer<typeof TileConfigSchema>;

export const MapViewKindSchema = z.enum(['plan', 'navigate', 'facility']);
export type MapViewKind = z.infer<typeof MapViewKindSchema>;

/** POST /analytics/map-sessions — the app reports each map session it starts. */
export const MapSessionStartSchema = z
  .object({
    session_id: IdSchema,
    view: MapViewKindSchema,
    started_at: IsoDateTimeSchema,
  })
  .strict();
export type MapSessionStart = z.infer<typeof MapSessionStartSchema>;

/** One day of map usage, for one device (debug panel) or all devices (provider reconciliation). */
export const MapUsageDaySchema = z.object({
  day: z.iso.date(),
  source: TileSourceSchema,
  /** Map sessions started (our analytics; MapTiler bills this integration per request). */
  sessions: z.number().int().nonnegative(),
  /** Requests the client(s) made to our tile proxy. */
  proxy_requests: z.number().int().nonnegative(),
  /** Requests our proxy made to the provider (no server cache for MapTiler, so ≈ proxy_requests). */
  upstream_requests: z.number().int().nonnegative(),
  /** Requests weighted the way the provider bills them (vector tile 1, 512px raster 4, style/fonts 0, …). */
  billable_requests: z.number().nonnegative(),
  /** Upstream requests by resource kind. */
  by_kind: z.record(z.string(), z.number().int().nonnegative()),
  /** Estimated provider cost at the configured unit price; null when unpriced. */
  estimated_cost_usd: z.number().nonnegative().nullable(),
});
export type MapUsageDay = z.infer<typeof MapUsageDaySchema>;

export const MapUsageResponseSchema = z.object({
  device_id: z.string().nullable(),
  days: z.array(MapUsageDaySchema),
  /** Users (devices) active per day — "per user per day" analytics. */
  per_device: z
    .array(z.object({ day: z.iso.date(), device_id: z.string(), account_id: z.string().nullable(), sessions: z.number().int(), proxy_requests: z.number().int(), billable_requests: z.number() }))
    .optional(),
});
export type MapUsageResponse = z.infer<typeof MapUsageResponseSchema>;
