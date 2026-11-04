import type { Route } from '@drayvision/shared';
import { initialNav, navReducer, type NavState } from '../src/navigation/navState';

const mkRoute = (id: string, status: Route['validation']['status'], maneuvers = 2): Route => ({
  id,
  profileId: 'p',
  origin: { lng: 0, lat: 0 },
  destination: { lng: 1, lat: 1 },
  geometry: [],
  distanceM: 1000,
  durationS: 60,
  legs: [
    {
      distanceM: 1000,
      durationS: 60,
      maneuvers: Array.from({ length: maneuvers }, (_, i) => ({ instruction: `m${i}`, type: 't', distanceM: 1, durationS: 1, location: { lng: 0, lat: 0 }, streetNames: [] })),
    },
  ],
  hazards: [],
  validation: { status, violations: [], warnings: [], restrictionsVersion: 'v', validatedAt: '2026-01-01T00:00:00Z' },
  graphVersion: 'g',
});

const run = (...events: Parameters<typeof navReducer>[1][]): NavState => events.reduce(navReducer, initialNav);

describe('navigation state', () => {
  it('never offers a route that failed validation', () => {
    const s = run({ type: 'PLAN' }, { type: 'ROUTES_LOADED', routes: [mkRoute('bad', 'fail'), mkRoute('ok', 'pass')] });
    expect(s.phase === 'previewing' && s.routes.map((r) => r.id)).toEqual(['ok']);
  });

  it('errors when every route failed validation', () => {
    expect(run({ type: 'ROUTES_LOADED', routes: [mkRoute('bad', 'fail')] }).phase).toBe('error');
  });

  it('runs preview → navigate → arrive', () => {
    const s = run({ type: 'ROUTES_LOADED', routes: [mkRoute('a', 'pass', 2)] }, { type: 'START' }, { type: 'ADVANCE_MANEUVER' }, { type: 'ADVANCE_MANEUVER' });
    expect(s.phase).toBe('arrived');
  });

  it('rejects an unsafe reroute', () => {
    const s = run({ type: 'ROUTES_LOADED', routes: [mkRoute('a', 'pass')] }, { type: 'START' }, { type: 'OFF_ROUTE' }, { type: 'REROUTED', route: mkRoute('b', 'fail') });
    expect(s).toEqual({ phase: 'error', message: 'Reroute failed safety validation' });
  });

  it('ignores START outside preview', () => {
    expect(run({ type: 'START' })).toEqual(initialNav);
  });
});
