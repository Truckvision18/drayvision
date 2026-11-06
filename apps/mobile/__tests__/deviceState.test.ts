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
} from '../src/profiles/deviceState';
import { lRoute, profile, response } from './fixtures';

const origin = { lng: 0, lat: 0 };
const dest = { lng: 0.01, lat: 0.01 };
const NOW = 1_000_000;
const TTL = 300;

function withCachedRoute(p = profile()): { state: DeviceState; key: string } {
  const key = routeCacheKey(origin, dest, p, 3);
  const state = putRoute(
    { ...emptyDevice, profiles: [p] },
    { key, truck_profile_id: p.id, truck_profile_version: p.version, destination: dest, stored_at: NOW, response: response(lRoute('r1', 'PASS', p)) },
    20,
  );
  return { state, key };
}

describe('device cache: profile versioning invalidates cached routes', () => {
  it('a cached route is served while its profile version is current', () => {
    const { state, key } = withCachedRoute();
    expect(getRoute(state, key, NOW + 1000, TTL)?.routes[0]?.route_id).toBe('r1');
  });

  it('EDITING the profile (new version from the server) purges routes computed under the old version', () => {
    const { state, key } = withCachedRoute();
    const edited = upsertProfile(state, profile({ version: 2, height_m: 4.27 }));
    expect(edited.routes).toHaveLength(0);
    expect(getRoute(edited, key, NOW + 1000, TTL)).toBeNull();
    // ...and the new version has its own key, so it can never collide with the old entry.
    expect(routeCacheKey(origin, dest, profile({ version: 2 }), 3)).not.toBe(key);
  });

  it('an edit made on ANOTHER device (seen on sync) purges too', () => {
    const { state } = withCachedRoute();
    expect(replaceProfiles(state, [profile({ version: 3 })]).routes).toHaveLength(0);
  });

  it('a sync that returns the same version keeps the cache', () => {
    const { state } = withCachedRoute();
    expect(replaceProfiles(state, [profile()]).routes).toHaveLength(1);
  });

  it('only the edited truck’s routes are purged', () => {
    const a = profile();
    const b = profile({ id: 'truck-2', is_default: false });
    let s: DeviceState = { ...emptyDevice, profiles: [a, b] };
    for (const p of [a, b]) {
      s = putRoute(s, { key: routeCacheKey(origin, dest, p, 3), truck_profile_id: p.id, truck_profile_version: p.version, destination: dest, stored_at: NOW, response: response(lRoute(p.id, 'PASS', p)) }, 20);
    }
    s = upsertProfile(s, profile({ version: 2 }));
    expect(s.routes.map((r) => r.truck_profile_id)).toEqual(['truck-2']);
  });

  it('deleting a profile drops its routes and falls back to the default', () => {
    const { state } = withCachedRoute();
    const b = profile({ id: 'truck-2', is_default: false });
    const s = removeProfile(setActive(upsertProfile(state, b), 'truck-1'), 'truck-1');
    expect(s.routes).toHaveLength(0);
    expect(activeProfile(s)?.id).toBe('truck-2');
  });

  it('a route cached for a profile version the device has never seen is unusable', () => {
    const { state, key } = withCachedRoute();
    const tampered: DeviceState = { ...state, routes: state.routes.map((r) => ({ ...r, truck_profile_version: 9 })) };
    expect(getRoute(tampered, key, NOW, TTL)).toBeNull();
  });

  it('expires by TTL from config', () => {
    const { state, key } = withCachedRoute();
    expect(getRoute(state, key, NOW + (TTL + 1) * 1000, TTL)).toBeNull();
  });
});

describe('device cache: profiles', () => {
  it('active = chosen, else account default, else none (never a made-up profile)', () => {
    const a = profile({ is_default: false });
    const b = profile({ id: 'truck-2', is_default: true });
    expect(activeProfile(emptyDevice)).toBeNull();
    expect(activeProfile({ ...emptyDevice, profiles: [a, b] })?.id).toBe('truck-2');
    expect(activeProfile(setActive({ ...emptyDevice, profiles: [a, b] }, 'truck-1'))?.id).toBe('truck-1');
  });

  it('making one profile default clears the flag on the others locally', () => {
    const s = upsertProfile({ ...emptyDevice, profiles: [profile(), profile({ id: 'truck-2', is_default: false })] }, profile({ id: 'truck-2', is_default: true }));
    expect(s.profiles.filter((p) => p.is_default).map((p) => p.id)).toEqual(['truck-2']);
  });

  it('persisted state is schema-validated; corrupt data is discarded, not trusted', () => {
    const { state } = withCachedRoute();
    expect(parseDeviceState(JSON.stringify(state))).toEqual(state);
    expect(parseDeviceState('{not json')).toEqual(emptyDevice);
    expect(parseDeviceState(JSON.stringify({ profiles: [{ id: 'x', height_m: 'tall' }], activeId: null, routes: [] }))).toEqual(emptyDevice);
    expect(parseDeviceState(null)).toEqual(emptyDevice);
  });
});
