import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { TruckProfile } from '@drayvision/shared';
import { api as defaultApi, type RoutingApi } from '../api/client';
import { config } from '../config';
import { useLocation } from '../location/LocationContext';
import { initialNav, navReducer, type NavEvent, type NavState } from './navState';
import { indexRoute, initialTracker, trackFix, type RouteIndex, type TrackerState } from './progress';

/** Speaks or displays an announcement. Voice (TTS) plugs in here later; default is display-only. */
export type Announcer = (text: string) => void;

interface NavValue {
  state: NavState;
  dispatch: React.Dispatch<NavEvent>;
  profile: TruckProfile;
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
 * Owns navigation state and its side effects:
 *  - planning:   ask OUR API for truck routes from the current GPS fix
 *  - navigating: feed every GPS fix through the progress tracker
 *  - rerouting:  re-plan from the current fix (rate-limited by config)
 */
export function NavProvider({
  children,
  api = defaultApi,
  profile = config.defaultTruckProfile,
  announce = silent,
}: {
  children: React.ReactNode;
  api?: RoutingApi;
  profile?: TruckProfile;
  announce?: Announcer;
}) {
  const [state, dispatch] = useReducer(navReducer, initialNav);
  const { fix } = useLocation();
  const fixRef = useRef(fix);
  fixRef.current = fix;

  // ---- planning ---------------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== 'planning') return;
    const origin = fixRef.current?.location;
    if (!origin) {
      dispatch({ type: 'FAIL', message: 'Waiting for a GPS fix — try again in a moment' });
      return;
    }
    let live = true;
    api
      .route(origin, state.destination, profile)
      .then((r) => live && dispatch({ type: 'ROUTES_LOADED', routes: r.routes }))
      .catch((err: unknown) => live && dispatch({ type: 'FAIL', message: message(err) }));
    return () => {
      live = false;
    };
  }, [state, api, profile]);

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
      api
        .route(origin, state.destination, profile)
        .then((r) => live && dispatch({ type: 'REROUTED', routes: r.routes }))
        .catch((err: unknown) => live && dispatch({ type: 'FAIL', message: message(err) }));
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [state, api, profile]);

  return <NavCtx.Provider value={{ state, dispatch, profile }}>{children}</NavCtx.Provider>;
}
