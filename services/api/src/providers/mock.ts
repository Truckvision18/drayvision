import { haversineM, type Camera, type TrafficEvent } from '@drayvision/shared';
import type { BBox, CameraProvider, ImageryProvider, Providers, RoutingProvider, TileProvider, TollProvider, TrafficProvider } from './types.js';

/**
 * Deterministic in-process providers. Used by unit tests and by any environment whose config
 * selects `mock`. They never touch the network and never require a key.
 */

// 1x1 transparent PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const mockSource = { kind: 'OFFICIAL' as const, name: 'mock', dataset_version: 'mock', retrieved_at: '2026-01-01T00:00:00Z', rights_id: 'osm' };

export const mockRouting: RoutingProvider = {
  name: 'mock',
  async route({ origin, destination }) {
    const distance_m = haversineM(origin, destination);
    // Straight line at a nominal 40 km/h purely so the shape is plausible in tests.
    const duration_s = distance_m / (40_000 / 3600);
    return [
      {
        geometry: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        maneuvers: [
          { instruction: 'Depart', verbal_instruction: null, type: 'depart', distance_m, duration_s, location: origin, street_names: [], begin_shape_index: 0, end_shape_index: 1 },
          { instruction: 'Arrive', verbal_instruction: null, type: 'arrive', distance_m: 0, duration_s: 0, location: destination, street_names: [], begin_shape_index: 1, end_shape_index: 1 },
        ],
        distance_m,
        duration_s,
        graph_version: 'mock',
      },
    ];
  },
  async status() {
    return { up: true, graphVersion: 'mock' };
  },
};

export const mockTiles: TileProvider = {
  name: 'mock',
  rightsId: 'osm',
  async style() {
    // An "empty map": background only. Lets the app launch with no MAPTILER_KEY.
    return {
      version: 8,
      name: 'DrayVision empty (mock)',
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9e5dc' } }],
    };
  },
  async resource() {
    return { contentType: 'image/png', body: PIXEL };
  },
};

export const mockTolls: TollProvider = {
  name: 'mock',
  rightsId: 'osm',
  async estimate(geometry, profile) {
    return {
      total: 0,
      items: [],
      transponders_applied: [...new Set(profile.transponders.map((t) => t.network))],
      provider: `mock(${geometry.length} pts, ${profile.axle_count} axles)`,
    };
  },
};

export const mockTraffic: TrafficProvider = {
  name: 'mock',
  rightsId: 'osm',
  async events(bbox: BBox): Promise<TrafficEvent[]> {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    return [
      {
        id: 'mock-incident-1',
        kind: 'CONSTRUCTION',
        severity: 'CAUTION',
        location: { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 },
        description: 'Mock lane closure',
        starts_at: null,
        ends_at: null,
        source: mockSource,
      },
    ];
  },
};

export const mockCameras: CameraProvider = {
  name: 'mock',
  rightsId: 'osm',
  async list(bbox: BBox): Promise<Camera[]> {
    const [minLng, minLat] = bbox;
    return [
      {
        id: 'mock-cam-1',
        name: 'Mock camera',
        location: { lng: minLng, lat: minLat },
        heading_deg: null,
        provider: 'mock',
        image_url: null,
        last_updated: null,
        rights_id: 'osm',
        attribution: 'mock',
      },
    ];
  },
  async image() {
    return { contentType: 'image/png', body: PIXEL };
  },
};

export const mockImagery: ImageryProvider = {
  name: 'mock',
  rightsId: 'osm',
  async preview() {
    return { contentType: 'image/png', body: PIXEL };
  },
};

export const mockProviders: Providers = {
  routing: mockRouting,
  tiles: mockTiles,
  tolls: mockTolls,
  traffic: mockTraffic,
  cameras: mockCameras,
  imagery: mockImagery,
};
