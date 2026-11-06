import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  profileCompleteness,
  type LngLat,
  type ProfileCompleteness,
  type RouteResponse,
  type TruckProfile,
  type TruckProfileCreate,
  type TruckProfileUpdate,
} from '@drayvision/shared';
import { createAsyncStorage } from '@react-native-async-storage/async-storage';
import { api as defaultApi, type ProfilesApi } from '../api/client';
import { config } from '../config';
import {
  activeProfile,
  emptyDevice,
  getRoute,
  parseDeviceState,
  putRoute,
  removeProfile,
  replaceProfiles,
  routeCacheKey,
  setActive,
  upsertProfile,
  type DeviceState,
} from './deviceState';

/** Minimal persistent key-value store (AsyncStorage on device; in-memory in tests). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const STORAGE_KEY = 'drayvision.device.v1';
let defaultStore: KeyValueStore | null = null;
/** The app's on-device key-value store (shared by profiles and the map config). */
export const deviceStore = (): KeyValueStore => (defaultStore ??= createAsyncStorage('drayvision'));

type Action =
  | { type: 'hydrate'; state: DeviceState }
  | { type: 'replace'; profiles: TruckProfile[] }
  | { type: 'upsert'; profile: TruckProfile }
  | { type: 'remove'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'putRoute'; entry: Parameters<typeof putRoute>[1] };

function reducer(s: DeviceState, a: Action): DeviceState {
  switch (a.type) {
    case 'hydrate':
      return a.state;
    case 'replace':
      return replaceProfiles(s, a.profiles);
    case 'upsert':
      return upsertProfile(s, a.profile);
    case 'remove':
      return removeProfile(s, a.id);
    case 'activate':
      return setActive(s, a.id);
    case 'putRoute':
      return putRoute(s, a.entry, config.deviceCache.maxRoutes);
  }
}

export type SyncStatus = 'loading' | 'synced' | 'offline';

export interface ProfilesValue {
  profiles: TruckProfile[];
  active: TruckProfile | null;
  /** Completeness of the active profile; `null` when there is no profile at all. */
  completeness: ProfileCompleteness | null;
  status: SyncStatus;
  refresh(): Promise<void>;
  activate(id: string): void;
  create(input: TruckProfileCreate): Promise<TruckProfile>;
  update(id: string, patch: TruckProfileUpdate): Promise<TruckProfile>;
  makeDefault(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Device route cache — keyed by trip AND the profile's exact version. */
  cachedRoute(origin: LngLat, destination: LngLat, profile: TruckProfile): RouteResponse | null;
  cacheRoute(origin: LngLat, destination: LngLat, profile: TruckProfile, response: RouteResponse): void;
}

const Ctx = createContext<ProfilesValue | null>(null);

export function useProfiles(): ProfilesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProfiles must be used inside <ProfileProvider>');
  return v;
}

/**
 * Profiles live on the server, per account; the device caches them (and recent routes) so the
 * app starts instantly and works offline. Every server response flows through the pure
 * functions in deviceState.ts, which drop cached routes computed for an older profile version.
 */
export function ProfileProvider({
  children,
  api = defaultApi,
  store,
}: {
  children: React.ReactNode;
  api?: ProfilesApi;
  store?: KeyValueStore;
}) {
  const kv = useMemo(() => store ?? deviceStore(), [store]);
  const [state, dispatch] = useReducer(reducer, emptyDevice);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const hydrated = useRef(false);

  const refresh = useCallback(async () => {
    try {
      dispatch({ type: 'replace', profiles: await api.listProfiles() });
      setStatus('synced');
    } catch {
      setStatus('offline'); // keep the cached copy
    }
  }, [api]);

  // Load the device cache first (instant start), then sync from the server.
  useEffect(() => {
    let live = true;
    kv.getItem(STORAGE_KEY)
      .catch(() => null)
      .then((raw) => {
        if (!live) return;
        dispatch({ type: 'hydrate', state: parseDeviceState(raw) });
        hydrated.current = true;
        void refresh();
      });
    return () => {
      live = false;
    };
  }, [kv, refresh]);

  // Persist every change (after hydration, so we never overwrite the cache with an empty state).
  useEffect(() => {
    if (hydrated.current) void kv.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [kv, state]);

  const active = activeProfile(state);
  const value: ProfilesValue = {
    profiles: state.profiles,
    active,
    completeness: active ? profileCompleteness(active) : null,
    status,
    refresh,
    activate: (id) => dispatch({ type: 'activate', id }),
    create: async (input) => {
      const p = await api.createProfile(input);
      dispatch({ type: 'upsert', profile: p });
      return p;
    },
    update: async (id, patch) => {
      const p = await api.updateProfile(id, patch);
      dispatch({ type: 'upsert', profile: p });
      return p;
    },
    makeDefault: async (id) => {
      dispatch({ type: 'upsert', profile: await api.setDefaultProfile(id) });
    },
    remove: async (id) => {
      await api.deleteProfile(id);
      dispatch({ type: 'remove', id });
      void refresh(); // the server may have promoted a new default
    },
    cachedRoute: (origin, destination, profile) =>
      getRoute(state, routeCacheKey(origin, destination, profile, config.deviceCache.originRoundingDecimals), Date.now(), config.deviceCache.routeTtlSeconds),
    cacheRoute: (origin, destination, profile, response) =>
      dispatch({
        type: 'putRoute',
        entry: {
          key: routeCacheKey(origin, destination, profile, config.deviceCache.originRoundingDecimals),
          truck_profile_id: profile.id,
          truck_profile_version: profile.version,
          destination,
          stored_at: Date.now(),
          response,
        },
      }),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
