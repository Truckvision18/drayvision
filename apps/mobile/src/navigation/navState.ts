import type { Route } from '@drayvision/shared';

/**
 * Turn-by-turn UI state machine (Phases 4–5). Pure reducer so it is fully unit-testable;
 * GPS matching and voice live elsewhere and dispatch events here.
 */
export type NavState =
  | { phase: 'idle' }
  | { phase: 'planning' }
  | { phase: 'previewing'; routes: Route[]; selected: number }
  | { phase: 'navigating'; route: Route; maneuverIndex: number; offRoute: boolean }
  | { phase: 'rerouting'; route: Route }
  | { phase: 'arrived'; route: Route }
  | { phase: 'error'; message: string };

export type NavEvent =
  | { type: 'PLAN' }
  | { type: 'ROUTES_LOADED'; routes: Route[] }
  | { type: 'SELECT'; index: number }
  | { type: 'START' }
  | { type: 'ADVANCE_MANEUVER' }
  | { type: 'OFF_ROUTE' }
  | { type: 'REROUTED'; route: Route }
  | { type: 'ARRIVED' }
  | { type: 'FAIL'; message: string }
  | { type: 'CANCEL' };

export const initialNav: NavState = { phase: 'idle' };

const maneuverCount = (r: Route): number => r.legs.reduce((n, l) => n + l.maneuvers.length, 0);

export function navReducer(s: NavState, e: NavEvent): NavState {
  switch (e.type) {
    case 'CANCEL':
      return initialNav;
    case 'FAIL':
      return { phase: 'error', message: e.message };
    case 'PLAN':
      return { phase: 'planning' };
    case 'ROUTES_LOADED': {
      // Safety: never offer a route that failed validation, whatever the server sent.
      const routes = e.routes.filter((r) => r.validation.status !== 'fail');
      if (routes.length === 0) return { phase: 'error', message: 'No truck-safe route found' };
      return { phase: 'previewing', routes, selected: 0 };
    }
    case 'SELECT':
      return s.phase === 'previewing' && e.index >= 0 && e.index < s.routes.length ? { ...s, selected: e.index } : s;
    case 'START': {
      if (s.phase !== 'previewing') return s;
      const route = s.routes[s.selected];
      return route ? { phase: 'navigating', route, maneuverIndex: 0, offRoute: false } : s;
    }
    case 'ADVANCE_MANEUVER':
      if (s.phase !== 'navigating') return s;
      return s.maneuverIndex + 1 >= maneuverCount(s.route) ? { phase: 'arrived', route: s.route } : { ...s, maneuverIndex: s.maneuverIndex + 1 };
    case 'OFF_ROUTE':
      return s.phase === 'navigating' ? { phase: 'rerouting', route: s.route } : s;
    case 'REROUTED':
      if (s.phase !== 'rerouting') return s;
      return e.route.validation.status === 'fail'
        ? { phase: 'error', message: 'Reroute failed safety validation' }
        : { phase: 'navigating', route: e.route, maneuverIndex: 0, offRoute: false };
    case 'ARRIVED':
      return s.phase === 'navigating' ? { phase: 'arrived', route: s.route } : s;
  }
}
