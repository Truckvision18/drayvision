import { LngLatSchema, RouteResponseSchema, TruckProfileSchema, type LngLat, type RouteResponse, type TruckProfile } from '@drayvision/shared';
import { z } from 'zod';

/**
 * What the device keeps between launches: the account's truck profiles (server is the source of
 * truth; this is a cache), which one is active, and recent route responses.
 *
 * Invariant: a cached route is only ever usable while its profile is at the SAME version it was
 * computed for. Every function that changes profiles purges routes computed under any other
 * version, so an edited truck can never be shown a route planned for the old one.
 */
export const CachedRouteSchema = z.object({
  key: z.string(),
  truck_profile_id: z.string(),
  truck_profile_version: z.number().int().min(1),
  destination: LngLatSchema,
  stored_at: z.number(),
  response: RouteResponseSchema,
});
export type CachedRoute = z.infer<typeof CachedRouteSchema>;

export const DeviceStateSchema = z.object({
  profiles: z.array(TruckProfileSchema),
  activeId: z.string().nullable(),
  routes: z.array(CachedRouteSchema),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const emptyDevice: DeviceState = { profiles: [], activeId: null, routes: [] };

/** Parse persisted state; anything corrupt or from an older shape is discarded, never trusted. */
export function parseDeviceState(raw: string | null): DeviceState {
  if (!raw) return emptyDevice;
  try {
    const r = DeviceStateSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : emptyDevice;
  } catch {
    return emptyDevice;
  }
}

const keepRoutesMatching = (routes: CachedRoute[], profiles: TruckProfile[]): CachedRoute[] =>
  routes.filter((r) => profiles.some((p) => p.id === r.truck_profile_id && p.version === r.truck_profile_version));

/** The profile routing should use: the chosen one, else the account default, else none. */
export function activeProfile(s: DeviceState): TruckProfile | null {
  return s.profiles.find((p) => p.id === s.activeId) ?? s.profiles.find((p) => p.is_default) ?? s.profiles[0] ?? null;
}

/** Replace the whole list with the server's (sync). Purges routes for changed or deleted profiles. */
export function replaceProfiles(s: DeviceState, profiles: TruckProfile[]): DeviceState {
  const activeId = profiles.some((p) => p.id === s.activeId) ? s.activeId : null;
  return { profiles, activeId, routes: keepRoutesMatching(s.routes, profiles) };
}

/** A single profile came back from the server (create / edit / set default). */
export function upsertProfile(s: DeviceState, p: TruckProfile): DeviceState {
  const others = s.profiles.filter((x) => x.id !== p.id).map((x) => (p.is_default && x.is_default ? { ...x, is_default: false } : x));
  const profiles = [...others, p];
  return { ...s, profiles, routes: keepRoutesMatching(s.routes, profiles) };
}

export function removeProfile(s: DeviceState, id: string): DeviceState {
  const profiles = s.profiles.filter((p) => p.id !== id);
  return { profiles, activeId: s.activeId === id ? null : s.activeId, routes: keepRoutesMatching(s.routes, profiles) };
}

export function setActive(s: DeviceState, id: string): DeviceState {
  return s.profiles.some((p) => p.id === id) ? { ...s, activeId: id } : s;
}

const round = (v: number, d: number): number => Number(v.toFixed(d));

/** Same trip + same profile version (+ nearby origin) → same cache entry. */
export function routeCacheKey(origin: LngLat, destination: LngLat, profile: Pick<TruckProfile, 'id' | 'version'>, originDecimals: number): string {
  return [profile.id, profile.version, round(origin.lng, originDecimals), round(origin.lat, originDecimals), destination.lng, destination.lat].join('|');
}

export function putRoute(s: DeviceState, entry: CachedRoute, maxRoutes: number): DeviceState {
  const routes = [...s.routes.filter((r) => r.key !== entry.key), entry].slice(-maxRoutes);
  return { ...s, routes: keepRoutesMatching(routes, s.profiles) };
}

/** A fresh cached response for this key whose profile version is still current, else null. */
export function getRoute(s: DeviceState, key: string, now: number, ttlSeconds: number): RouteResponse | null {
  const hit = s.routes.find((r) => r.key === key);
  if (!hit || now - hit.stored_at > ttlSeconds * 1000) return null;
  const p = s.profiles.find((x) => x.id === hit.truck_profile_id);
  return p && p.version === hit.truck_profile_version ? hit.response : null;
}
