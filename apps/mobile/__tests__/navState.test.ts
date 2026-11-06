import { activeRoute, initialNav, navReducer, type NavEvent, type NavState } from '../src/navigation/navState';
import type { Progress } from '../src/navigation/progress';
import { lRoute } from './fixtures';

const dest = { lng: 0.01, lat: 0.01 };
const run = (...events: NavEvent[]): NavState => events.reduce(navReducer, initialNav);
const toPreview = (...routes: ReturnType<typeof lRoute>[]): NavEvent[] => [
  { type: 'SET_DESTINATION', destination: dest },
  { type: 'PLAN' },
  { type: 'ROUTES_LOADED', routes },
];
const progress = { nextManeuverIndex: 1 } as Progress;

describe('navigation state', () => {
  it('cannot plan without a destination', () => {
    expect(run({ type: 'PLAN' })).toEqual(initialNav);
  });

  it('never offers a route that failed validation', () => {
    const s = run(...toPreview(lRoute('bad', 'FAIL'), lRoute('ok', 'PASS')));
    expect(s.phase === 'previewing' && s.routes.map((r) => r.route_id)).toEqual(['ok']);
  });

  it('errors when every route failed validation, keeping the destination for retry', () => {
    const s = run(...toPreview(lRoute('bad', 'FAIL')));
    expect(s).toMatchObject({ phase: 'error', destination: dest });
    expect(navReducer(s, { type: 'PLAN' }).phase).toBe('planning');
  });

  it('ignores routes that arrive after the user cancelled', () => {
    expect(run({ type: 'SET_DESTINATION', destination: dest }, { type: 'PLAN' }, { type: 'CANCEL' }, { type: 'ROUTES_LOADED', routes: [lRoute()] })).toEqual(initialNav);
  });

  it('runs preview → navigate → progress → arrive', () => {
    const s = run(...toPreview(lRoute('a'), lRoute('b')), { type: 'SELECT', index: 1 }, { type: 'START' }, { type: 'PROGRESS', progress });
    expect(s).toMatchObject({ phase: 'navigating', progress });
    expect(s.phase === 'navigating' && s.route.route_id).toBe('b');
    expect(navReducer(s, { type: 'ARRIVED' }).phase).toBe('arrived');
  });

  it('records the last announcement for on-screen display', () => {
    const s = run(...toPreview(lRoute()), { type: 'START' }, { type: 'ANNOUNCE', text: 'Turn right.' });
    expect(s.phase === 'navigating' && s.lastAnnouncement).toBe('Turn right.');
  });

  it('reroutes onto the first safe route and rejects an all-unsafe reroute', () => {
    const navigating = run(...toPreview(lRoute('a')), { type: 'START' }, { type: 'OFF_ROUTE' });
    expect(navigating.phase).toBe('rerouting');
    const ok = navReducer(navigating, { type: 'REROUTED', routes: [lRoute('x', 'FAIL'), lRoute('y')] });
    expect(ok.phase === 'navigating' && ok.route.route_id).toBe('y');
    expect(navReducer(navigating, { type: 'REROUTED', routes: [lRoute('x', 'FAIL')] })).toMatchObject({
      phase: 'error',
      message: 'Reroute failed safety validation',
    });
  });

  it('will not change destination mid-trip', () => {
    const s = run(...toPreview(lRoute()), { type: 'START' }, { type: 'SET_DESTINATION', destination: { lng: 5, lat: 5 } });
    expect(s.phase).toBe('navigating');
    expect(s.destination).toEqual(dest);
  });

  it('activeRoute follows the selection and the trip', () => {
    const p = run(...toPreview(lRoute('a'), lRoute('b')), { type: 'SELECT', index: 1 });
    expect(activeRoute(p)?.route_id).toBe('b');
    expect(activeRoute(initialNav)).toBeNull();
  });
});
