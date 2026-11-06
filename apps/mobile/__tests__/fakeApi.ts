import {
  MAPTILER_ATTRIBUTION,
  OSM_ATTRIBUTION,
  isCompleteProfile,
  profileCompleteness,
  TruckProfileCreateSchema,
  TruckProfileSchema,
  type Facility,
  type Hazard,
  type MapUsageResponse,
  type RouteRequest,
  type SponsoredListing,
  type TileConfig,
  type TrafficEvent,
  type RouteResponse,
  type TruckProfile,
  type TruckProfileCreate,
  type TruckProfileUpdate,
} from '@drayvision/shared';
import { ApiError, type DrayVisionApi } from '../src/api/client';
import type { KeyValueStore } from '../src/profiles/ProfileContext';
import { lRoute, response } from './fixtures';

/**
 * In-memory stand-in for the DrayVision API with the SAME profile rules as the server:
 * versions bump on edit, stale edits get VERSION_CONFLICT, incomplete profiles can't route.
 */
export function fakeApi(initial: TruckProfile[] = []) {
  let profiles = [...initial];
  let n = 0;
  let clock = Date.parse('2026-11-06T12:00:00Z');
  const ts = () => new Date((clock += 1000)).toISOString();

  const route = jest.fn(async (req: RouteRequest): Promise<RouteResponse> => {
    const p = profiles.find((x) => x.id === req.truck_profile_id);
    if (!p) throw new ApiError(404, { error: 'PROFILE_NOT_FOUND', message: 'not found' });
    if (!isCompleteProfile(p)) {
      const c = profileCompleteness(p);
      throw new ApiError(422, { error: 'PROFILE_INCOMPLETE', message: c.message!, missing_fields: c.missing_fields });
    }
    n += 1;
    return response(lRoute(`route-${n}`, 'PASS', p));
  });

  let tile = tileConfigFixture('maptiler');
  const overlays = overlayFixtures();

  const api: DrayVisionApi & { setDeviceId: jest.Mock; baseUrl: string; styleUrl: string } = {
    baseUrl: 'http://api.test',
    styleUrl: 'http://api.test/tiles/style.json',
    setDeviceId: jest.fn(),
    tileConfig: jest.fn(async () => tile),
    reportMapSession: jest.fn(async () => undefined),
    myMapUsage: jest.fn(
      async (): Promise<MapUsageResponse> => ({
        device_id: 'dev-x',
        days: [{ day: '2026-11-06', source: tile.source, sessions: 3, proxy_requests: 120, upstream_requests: 120, billable_requests: 96, by_kind: {}, estimated_cost_usd: 0.0144 }],
      }),
    ),
    restrictions: jest.fn(async () => overlays.restrictions),
    traffic: jest.fn(async () => overlays.traffic),
    cameras: jest.fn(async () => []),
    facilities: jest.fn(async () => overlays.facilities),
    sponsored: jest.fn(async () => overlays.sponsored),
    route,
    listProfiles: jest.fn(async () => [...profiles]),
    createProfile: jest.fn(async (input: TruckProfileCreate) => {
      const { is_default, ...fields } = TruckProfileCreateSchema.parse(input);
      const first = profiles.length === 0;
      if (first || is_default) profiles = profiles.map((x) => ({ ...x, is_default: false }));
      const t = ts();
      const p = TruckProfileSchema.parse({ ...fields, id: `truck-${profiles.length + 1}`, account_id: 'dev-device-account', version: 1, is_default: first || !!is_default, created_at: t, updated_at: t });
      profiles.push(p);
      return p;
    }),
    updateProfile: jest.fn(async (id: string, patch: TruckProfileUpdate) => {
      const cur = profiles.find((x) => x.id === id);
      if (!cur) throw new ApiError(404, { error: 'PROFILE_NOT_FOUND', message: 'not found' });
      if (patch.expected_version !== cur.version) throw new ApiError(409, { error: 'VERSION_CONFLICT', message: 'conflict', current_version: cur.version });
      const { expected_version: _e, ...fields } = patch;
      const next = TruckProfileSchema.parse({ ...cur, ...fields, version: cur.version + 1, updated_at: ts() });
      profiles = profiles.map((x) => (x.id === id ? next : x));
      return next;
    }),
    setDefaultProfile: jest.fn(async (id: string) => {
      profiles = profiles.map((x) => ({ ...x, is_default: x.id === id }));
      return profiles.find((x) => x.id === id)!;
    }),
    deleteProfile: jest.fn(async (id: string) => {
      profiles = profiles.filter((x) => x.id !== id);
    }),
  };
  return {
    api,
    route,
    /** Flip the server's tile-source flag (what ops would do in config). */
    setTileSource: (source: TileConfig['source']) => {
      tile = tileConfigFixture(source);
    },
    /** Simulate an edit made on another device. */
    editElsewhere: (id: string, fields: Partial<TruckProfile>) => {
      profiles = profiles.map((x) => (x.id === id ? { ...x, ...fields, version: x.version + 1, updated_at: ts() } : x));
    },
    current: () => profiles,
  };
}

export function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  };
}

export function tileConfigFixture(source: TileConfig['source']): TileConfig {
  const maptiler = source === 'maptiler';
  return {
    config_version: `v-${source}`,
    source,
    delivery: 'proxy',
    style_url: `http://api.test/tiles/${source}/style.json`,
    layer_anchors: true,
    attribution: maptiler ? [MAPTILER_ATTRIBUTION, OSM_ATTRIBUTION] : [OSM_ATTRIBUTION],
    billing_unit: maptiler ? 'request' : 'none',
    device_cache: { ambient_cache_bytes: 268_435_456 },
    prefetch: { enabled: !maptiler, corridor_buffer_m: 500, corridor_chunk_m: 1000, destination_radius_m: 1500, min_zoom: 10, max_zoom: 16, max_tiles_per_pack: 2000, max_packs: 80 },
    export: { snapshot_allowed: !maptiler },
    session: { max_duration_s: 21_600, max_requests: 10_000 },
  };
}

const src = { kind: 'OFFICIAL' as const, name: 'fixture', dataset_version: '1', retrieved_at: '2026-11-01T00:00:00Z', rights_id: 'osm' };

export function overlayFixtures(): { restrictions: Hazard[]; traffic: TrafficEvent[]; facilities: Facility[]; sponsored: SponsoredListing[] } {
  return {
    restrictions: [
      { id: 'bridge-9', type: 'LOW_CLEARANCE', location: { lng: -74.1, lat: 40.7 }, value: 3.9, restriction: null, hazmat_classes: [], description: 'low bridge', source: src, confidence: 1, resolved: false },
    ],
    traffic: [{ id: 't1', kind: 'INCIDENT', severity: 'CAUTION', location: { lng: -74.12, lat: 40.69 }, description: 'crash', starts_at: null, ends_at: null, source: src }],
    facilities: [
      {
        id: 'fac-1',
        name: 'Port Fixture Terminal',
        kind: 'PORT_TERMINAL',
        street_address: '1 Fixture Way',
        truck_entrances: [
          { id: 'g1', coords: { lng: -74.15, lat: 40.68 }, street: 'Corbin St', is_primary: true, verified_by: 'ops', verified_at: '2026-01-01T00:00:00.000Z', source: 'OFFICIAL', notes: null },
        ],
        receiving_office: null,
        staging_area: null,
        docks: [],
        notes: [],
        verification_state: 'VERIFIED',
        requires_twic: true,
      },
    ],
    sponsored: [
      { id: 'sp1', facility_id: null, title: 'Truck wash', location: { lng: -74.13, lat: 40.67 }, label: 'Sponsored', active_from: '2026-01-01T00:00:00.000Z', active_to: '2027-01-01T00:00:00.000Z' },
    ],
  };
}
