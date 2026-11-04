import type { Camera, Hazard, LngLat } from '@drayvision/shared';
import type { BBox, CameraProvider, ImageryProvider, Providers, RoutingProvider, TileProvider, TollProvider, TrafficProvider } from './types.js';

/**
 * Deterministic in-process providers. Used by unit tests and by any environment whose config
 * selects `mock`. They never touch the network and never require a key.
 */

// 1x1 transparent PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const mockProvenance = { source: 'mock', sourceVersion: 'mock', retrievedAt: '2026-01-01T00:00:00Z', rightsId: 'osm' };

function haversineM(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const mockRouting: RoutingProvider = {
  name: 'mock',
  async route({ origin, destination, profile }) {
    const distanceM = haversineM(origin, destination);
    // Straight line at a nominal 40 km/h purely so the shape is plausible in tests.
    const durationS = distanceM / (40_000 / 3600);
    return [
      {
        id: 'mock-route-1',
        profileId: profile.id,
        origin,
        destination,
        geometry: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        distanceM,
        durationS,
        legs: [
          {
            distanceM,
            durationS,
            maneuvers: [
              { instruction: 'Depart', type: 'depart', distanceM, durationS, location: origin, streetNames: [] },
              { instruction: 'Arrive', type: 'arrive', distanceM: 0, durationS: 0, location: destination, streetNames: [] },
            ],
          },
        ],
        graphVersion: 'mock',
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
  async estimate(geometry) {
    return {
      currency: 'USD',
      total: 0,
      items: [],
      isEstimate: true,
      provider: `mock(${geometry.length} pts)`,
      computedAt: '2026-01-01T00:00:00Z',
    };
  },
};

export const mockTraffic: TrafficProvider = {
  name: 'mock',
  rightsId: 'osm',
  async events(bbox: BBox): Promise<Hazard[]> {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    return [
      {
        id: 'mock-incident-1',
        kind: 'construction',
        severity: 'caution',
        location: { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 },
        description: 'Mock lane closure',
        provenance: mockProvenance,
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
        provider: 'mock',
        rightsId: 'osm',
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
