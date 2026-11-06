import {
  isCompleteProfile,
  profileCompleteness,
  TruckProfileCreateSchema,
  TruckProfileSchema,
  type RouteRequest,
  type RouteResponse,
  type TruckProfile,
  type TruckProfileCreate,
  type TruckProfileUpdate,
} from '@drayvision/shared';
import { ApiError, type ProfilesApi, type RoutingApi } from '../src/api/client';
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

  const api: RoutingApi & ProfilesApi = {
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
