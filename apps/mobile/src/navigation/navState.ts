import type { LngLat, Route } from '@drayvision/shared';
import type { Progress } from './progress';

/**
 * Turn-by-turn UI state machine (Phases 4–5). A pure reducer, so it is fully unit-testable.
 * GPS tracking (progress.ts) and the API client dispatch events here; screens only read it.
 */
export type NavState =
  | { phase: 'idle'; destination: LngLat | null }
  | { phase: 'planning'; destination: LngLat }
  | { phase: 'previewing'; destination: LngLat; routes: Route[]; selected: number }
  | { phase: 'navigating'; destination: LngLat; route: Route; progress: Progress | null; lastAnnouncement: string | null }
  | { phase: 'rerouting'; destination: LngLat; route: Route }
  | { phase: 'arrived'; destination: LngLat; route: Route }
  | { phase: 'error'; destination: LngLat | null; message: string };

export type NavEvent =
  | { type: 'SET_DESTINATION'; destination: LngLat }
  | { type: 'PLAN' }
  | { type: 'ROUTES_LOADED'; routes: Route[] }
  | { type: 'SELECT'; index: number }
  | { type: 'START' }
  | { type: 'PROGRESS'; progress: Progress }
  | { type: 'ANNOUNCE'; text: string }
  | { type: 'OFF_ROUTE' }
  | { type: 'REROUTED'; routes: Route[] }
  | { type: 'ARRIVED' }
  | { type: 'FAIL'; message: string }
  | { type: 'CANCEL' };

export const initialNav: NavState = { phase: 'idle', destination: null };

/** Safety: never offer a route that failed validation, whatever the server sent. */
const navigable = (routes: Route[]): Route[] => routes.filter((r) => r.validation.status !== 'fail');

const destinationOf = (s: NavState): LngLat | null => s.destination;

export function navReducer(s: NavState, e: NavEvent): NavState {
  switch (e.type) {
    case 'CANCEL':
      return initialNav;
    case 'FAIL':
      return { phase: 'error', destination: destinationOf(s), message: e.message };
    case 'SET_DESTINATION':
      // Changing the destination mid-trip is not allowed: cancel first.
      return s.phase === 'navigating' || s.phase === 'rerouting' ? s : { phase: 'idle', destination: e.destination };
    case 'PLAN': {
      const destination = destinationOf(s);
      return destination && (s.phase === 'idle' || s.phase === 'error' || s.phase === 'previewing') ? { phase: 'planning', destination } : s;
    }
    case 'ROUTES_LOADED': {
      if (s.phase !== 'planning') return s;
      const routes = navigable(e.routes);
      if (routes.length === 0) return { phase: 'error', destination: s.destination, message: 'No truck-safe route found' };
      return { phase: 'previewing', destination: s.destination, routes, selected: 0 };
    }
    case 'SELECT':
      return s.phase === 'previewing' && e.index >= 0 && e.index < s.routes.length ? { ...s, selected: e.index } : s;
    case 'START': {
      if (s.phase !== 'previewing') return s;
      const route = s.routes[s.selected];
      return route ? { phase: 'navigating', destination: s.destination, route, progress: null, lastAnnouncement: null } : s;
    }
    case 'PROGRESS':
      return s.phase === 'navigating' ? { ...s, progress: e.progress } : s;
    case 'ANNOUNCE':
      return s.phase === 'navigating' ? { ...s, lastAnnouncement: e.text } : s;
    case 'OFF_ROUTE':
      return s.phase === 'navigating' ? { phase: 'rerouting', destination: s.destination, route: s.route } : s;
    case 'REROUTED': {
      if (s.phase !== 'rerouting') return s;
      const [route] = navigable(e.routes);
      return route
        ? { phase: 'navigating', destination: s.destination, route, progress: null, lastAnnouncement: null }
        : { phase: 'error', destination: s.destination, message: 'Reroute failed safety validation' };
    }
    case 'ARRIVED':
      return s.phase === 'navigating' ? { phase: 'arrived', destination: s.destination, route: s.route } : s;
  }
}

/** The route currently drawn on the map, if any. */
export function activeRoute(s: NavState): Route | null {
  switch (s.phase) {
    case 'previewing':
      return s.routes[s.selected] ?? null;
    case 'navigating':
    case 'rerouting':
    case 'arrived':
      return s.route;
    default:
      return null;
  }
}
