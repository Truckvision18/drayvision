import {
  layerAnchorId,
  MAP_LAYER_ORDER,
  type Camera,
  type Facility,
  type Hazard,
  type MapLayerId,
  type Route,
  type SponsoredListing,
  type TrafficEvent,
} from '@drayvision/shared';
import { colors } from '../theme';

/**
 * Everything drawn on top of the base map, as plain data. Pure functions here turn it into
 * GeoJSON + MapLibre layer specs; MapOverlays.tsx mounts them in MAP_LAYER_ORDER.
 */
export interface OverlayData {
  route: Route | null;
  /** Verified restrictions in view (GET /restrictions). */
  restrictions: Hazard[];
  traffic: TrafficEvent[];
  cameras: Camera[];
  facilities: Facility[];
  sponsored: SponsoredListing[];
}

export const emptyOverlays: OverlayData = { route: null, restrictions: [], traffic: [], cameras: [], facilities: [], sponsored: [] };

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });
const point = (lng: number, lat: number, properties: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties,
});

/** Hazards = the active route's evaluated hazards (resolved for THIS truck or not) + other restrictions in view. */
export function hazardsGeoJSON(d: OverlayData): FC {
  const onRoute = d.route?.safety_result.hazards ?? [];
  const seen = new Set(onRoute.map((h) => h.id));
  const all = [...onRoute, ...d.restrictions.filter((h) => !seen.has(h.id))];
  return fc(all.map((h) => point(h.location.lng, h.location.lat, { id: h.id, type: h.type, resolved: h.resolved, on_route: seen.has(h.id) })));
}

export function geoJSONFor(layer: MapLayerId, d: OverlayData): FC {
  switch (layer) {
    case 'route':
      return fc(d.route ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: d.route.geometry.map((c) => [c[0], c[1]]) }, properties: {} }] : []);
    case 'hazards':
      return hazardsGeoJSON(d);
    case 'traffic':
      return fc(d.traffic.map((e) => point(e.location.lng, e.location.lat, { id: e.id, kind: e.kind, severity: e.severity })));
    case 'cameras':
      return fc(d.cameras.map((c) => point(c.location.lng, c.location.lat, { id: c.id, name: c.name })));
    case 'facilities':
      return fc(
        d.facilities.flatMap((f) =>
          f.truck_entrances.map((e) => point(e.coords.lng, e.coords.lat, { facility_id: f.id, name: f.name, primary: e.is_primary, source: e.source })),
        ),
      );
    case 'sponsored':
      // Always labelled "Sponsored" — the label comes from the data contract (literal 'Sponsored').
      return fc(d.sponsored.map((s) => point(s.location.lng, s.location.lat, { id: s.id, title: s.title, label: s.label })));
  }
}

export interface SubLayerSpec {
  id: string;
  type: 'line' | 'circle' | 'symbol';
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/** MapLibre layers per overlay. Sponsored pins are deliberately unlike any safety marker. */
export const LAYER_SPECS: Record<MapLayerId, SubLayerSpec[]> = {
  route: [
    { id: 'dv-route-casing', type: 'line', paint: { 'line-color': '#0b3d91', 'line-width': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
    { id: 'dv-route-line', type: 'line', paint: { 'line-color': '#3d8bfd', 'line-width': 6 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
  ],
  hazards: [
    {
      id: 'dv-hazards',
      type: 'circle',
      paint: {
        // unresolved = needs attention (red), resolved for this truck = grey
        'circle-color': ['case', ['get', 'resolved'], '#8a8f98', colors.danger],
        'circle-radius': ['case', ['get', 'on_route'], 9, 6],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
  ],
  traffic: [
    {
      id: 'dv-traffic',
      type: 'circle',
      paint: { 'circle-color': ['match', ['get', 'severity'], 'BLOCKING', '#b91c1c', 'CAUTION', '#f59e0b', '#fcd34d'], 'circle-radius': 7, 'circle-stroke-color': '#000', 'circle-stroke-width': 1 },
    },
  ],
  cameras: [{ id: 'dv-cameras', type: 'circle', paint: { 'circle-color': '#2563eb', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } }],
  facilities: [
    {
      id: 'dv-entrances',
      type: 'circle',
      paint: {
        'circle-color': ['match', ['get', 'source'], 'OFFICIAL', '#16a34a', 'DRIVER_VERIFIED', '#65a30d', '#9ca3af'],
        'circle-radius': ['case', ['get', 'primary'], 8, 5],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    },
    { id: 'dv-facility-names', type: 'symbol', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-optional': true }, paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1 } },
  ],
  sponsored: [
    { id: 'dv-sponsored-pin', type: 'circle', paint: { 'circle-color': colors.sponsored, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
    {
      id: 'dv-sponsored-label',
      type: 'symbol',
      layout: { 'text-field': ['concat', ['get', 'label'], ' · ', ['get', 'title']], 'text-size': 11, 'text-offset': [0, 1.3], 'text-optional': true },
      paint: { 'text-color': colors.sponsored, 'text-halo-color': '#fff', 'text-halo-width': 1 },
    },
  ],
};

/** Insert each overlay below the anchor of the overlay above it → stack order never drifts. */
export function beforeIdFor(layer: MapLayerId): string {
  const i = MAP_LAYER_ORDER.indexOf(layer);
  return layerAnchorId(MAP_LAYER_ORDER[i + 1] ?? 'top');
}
