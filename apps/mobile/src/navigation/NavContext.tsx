import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { profileCompleteness, type LngLat, type RouteResponse, type TruckProfile } from '@drayvision/shared';
import { api as defaultApi, type RoutingApi } from '../api/client';
import { config } from '../config';
import { useLocation } from '../location/LocationContext';
import { syncPrefetch } from '../map/prefetch';
import { useTileConfig } from '../map/TileConfigContext';
import { useProfiles, type ProfilesValue } from '../profiles/ProfileContext';
import { activeRoute, initialNav, navReducer, type NavEvent, type NavState } from './navState';
import { indexRoute, initialTracker, trackFix, type RouteIndex, type TrackerState } from './progress';

/** Speaks or displays an announcement. Voice (TTS) plugs in here later; default is display-only. */
export type Announcer = (text: string) => void;

interface NavValue {
  state: NavState;
  dispatch: React.Dispatch<NavEvent>;
}

const NavCtx = createContext<NavValue | null>(null);

export function useNav(): NavValue {
  const v = useContext(NavCtx);
  if (!v) throw new Error('useNav must be used inside <NavProvider>');
  return v;
}

const silent: Announcer = () => undefined;

const message = (err: unknown): string => (err instanceof Error ? err.message : 'Routing failed');

/**
 * Ask for truck routes for the ACTIVE profile. Never guesses a profile: no profile or an
 * incomplete one is a failure with the "complete your truck profile" message (the server
 * enforces the same rule). Uses the device route cache, which is keyed by profile version.
 */
async function requestRoutes(api: RoutingApi, profiles: ProfilesValue, profile: TruckProfile | null, origin: LngLat, destination: LngLat): Promise<RouteResponse> {
  if (!profile) throw new Error('Add a truck profile before planning a route.');
  const completeness = profileCompleteness(profile);
  if (!completeness.complete) throw new Error(completeness.message!);
  const cached = profiles.cachedRoute(origin, destination, profile);
  if (cached) return cached;
  const response = await api.route({
    origin,
    destination_coords: destination,
    truck_profile_id: profile.id,
    departure_time: new Date().toISOString(),
  });
  profiles.cacheRoute(origin, destination, profile, response);
  return response;
}

/**
 * Owns navigation state and its side effects:
 *  - planning:   ask OUR API for truck routes from the current GPS fix, for the active profile
 *  - navigating: feed every GPS fix through the progress tracker
 *  - rerouting:  re-plan from the current fix (rate-limited by config)
 *  - profile changes: a route planned for another truck (or an older version of this one) is
 *    void — previews are replanned, an active trip reroutes.
 */
export function NavProvider({ children, api = defaultApi, announce = silent }: { children: React.ReactNode; api?: RoutingApi; announce?: Announcer }) {
  const [state, dispatch] = useReducer(navReducer, initialNav);
  const { fix } = useLocation();
  const profiles = useProfiles();
  const fixRef = useRef(fix);
  fixRef.current = fix;
  // Effects below read these through refs so a re-render never re-fires a request.
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const apiRef = useRef(api);
  apiRef.current = api;

  // ---- planning ---------------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== 'planning') return;
    const origin = fixRef.current?.location;
    if (!origin) {
      dispatch({ type: 'FAIL', message: 'Waiting for a GPS fix — try again in a moment' });
      return;
    }
    let live = true;
    requestRoutes(apiRef.current, profilesRef.current, profilesRef.current.active, origin, state.destination)
      .then((r) => live && dispatch({ type: 'ROUTES_LOADED', routes: r.routes }))
      .catch((err: unknown) => live && dispatch({ type: 'FAIL', message: message(err) }));
    return () => {
      live = false;
    };
  }, [state]);

  // ---- profile changed under a shown / active route -----------------------------------------
  const shown = activeRoute(state);
  const active = profiles.active;
  useEffect(() => {
    if (!shown || (state.phase !== 'previewing' && state.phase !== 'navigating')) return;
    const v = shown.data_versions;
    if (!active || v.truck_profile_id !== active.id || v.truck_profile_version !== active.version) dispatch({ type: 'PROFILE_CHANGED' });
  }, [shown, state.phase, active]);

  // ---- navigating: progress tracking ------------------------------------------------------
  const navRoute = state.phase === 'navigating' ? state.route : null;
  const routeIndex = useMemo<RouteIndex | null>(() => (navRoute ? indexRoute(navRoute) : null), [navRoute]);
  const tracker = useRef<TrackerState>(initialTracker);
  const lastTracked = useRef<{ index: RouteIndex | null; fix: typeof fix }>({ index: null, fix: null });
  const announceRef = useRef(announce);
  announceRef.current = announce;

  useEffect(() => {
    if (!routeIndex || !fix) return;
    // Each GPS fix is processed exactly once per route (renders must never re-feed the tracker).
    if (lastTracked.current.index === routeIndex && lastTracked.current.fix === fix) return;
    if (lastTracked.current.index !== routeIndex) tracker.current = initialTracker; // new route → fresh tracker
    lastTracked.current = { index: routeIndex, fix };
    const { state: next, events } = trackFix(routeIndex, tracker.current, fix, config.navigation);
    tracker.current = next;
    for (const e of events) {
      if (e.type === 'progress') dispatch({ type: 'PROGRESS', progress: e.progress });
      else if (e.type === 'announce') {
        announceRef.current(e.text);
        dispatch({ type: 'ANNOUNCE', text: e.text });
      } else if (e.type === 'off-route') dispatch({ type: 'OFF_ROUTE' });
      else dispatch({ type: 'ARRIVED' });
    }
  }, [routeIndex, fix]);

  // ---- corridor prefetch --------------------------------------------------------------------
  // Only during an active trip, only the route corridor + destination area. Trip over (or a new
  // route) → our old packs are deleted, so nothing outside the current corridor stays prefetched.
  const { tileConfig } = useTileConfig();
  const tripRoute = state.phase === 'navigating' || state.phase === 'rerouting' ? state.route : null;
  useEffect(() => {
    void syncPrefetch(tripRoute, tileConfig).catch(() => undefined); // prefetch is an optimisation, never a blocker
  }, [tripRoute, tileConfig]);

  // ---- rerouting --------------------------------------------------------------------------
  const lastRerouteAt = useRef(0);
  useEffect(() => {
    if (state.phase !== 'rerouting') return;
    const origin = fixRef.current?.location;
    const wait = Math.max(0, lastRerouteAt.current + config.navigation.rerouteMinIntervalSeconds * 1000 - Date.now());
    let live = true;
    const timer = setTimeout(() => {
      if (!origin) return dispatch({ type: 'FAIL', message: 'Lost GPS while rerouting' });
      lastRerouteAt.current = Date.now();
      requestRoutes(apiRef.current, profilesRef.current, profilesRef.current.active, origin, state.destination)
        .then((r) => live && dispatch({ type: 'REROUTED', routes: r.routes }))
        .catch((err: unknown) => live && dispatch({ type: 'FAIL', message: message(err) }));
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [state]);

  return <NavCtx.Provider value={{ state, dispatch }}>{children}</NavCtx.Provider>;
}
