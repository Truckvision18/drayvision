import { buildConfig } from '../src/config';
import { computeProgress, indexRoute, initialTracker, trackFix, type Fix, type TrackerState } from '../src/navigation/progress';
import { lRoute, north } from './fixtures';

const cfg = buildConfig('dev').navigation;
const idx = indexRoute(lRoute());
const fix = (lng: number, lat: number, t: number, accuracyM = 5): Fix => ({ location: { lng, lat }, accuracyM, timestamp: t * 1000 });

function run(...fixes: Fix[]) {
  let state: TrackerState = initialTracker;
  const events = [];
  for (const f of fixes) {
    const r = trackFix(idx, state, f, cfg);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('route progress', () => {
  it('indexes maneuvers by distance along the route', () => {
    expect(idx.maneuverAlongM.map(Math.round)).toEqual([0, 1112, 2224]);
    expect(Math.round(idx.totalM)).toBe(2224);
  });

  it('snaps a fix, finds the next maneuver and the distance to it', () => {
    const p = computeProgress(idx, fix(0.00005, north(500), 0), 0, cfg);
    expect(p.crossTrackM).toBeCloseTo(5.6, 0);
    expect(Math.round(p.alongM)).toBe(500);
    expect(p.nextManeuverIndex).toBe(1);
    expect(Math.round(p.distanceToNextManeuverM)).toBe(612);
    expect(Math.round(p.remainingM)).toBe(1724);
    expect(p.remainingS).toBeCloseTo((200 * p.remainingM) / idx.totalM, 6);
  });

  it('after the turn, the next maneuver is arrival', () => {
    const p = computeProgress(idx, fix(0.005, 0.01, 0), 1112, cfg);
    expect(p.nextManeuverIndex).toBe(2);
  });

  it('announces each threshold once, using the voice text', () => {
    const near = (m: number, t: number) => fix(0, north(1112 - m), t);
    const { events } = run(near(900, 0), near(790, 1), near(700, 2), near(290, 3), near(280, 4), near(50, 5));
    const said = events.filter((e) => e.type === 'announce');
    expect(said.map((e) => e.type === 'announce' && e.atM)).toEqual([800, 300, 60]);
    expect(said[0]).toMatchObject({ maneuverIndex: 1, text: 'Turn right onto Port Street.' });
  });

  it('starting close to a maneuver announces only the nearest threshold', () => {
    const { events } = run(fix(0, north(1112 - 250), 0));
    expect(events.filter((e) => e.type === 'announce').map((e) => e.type === 'announce' && e.atM)).toEqual([300]);
  });

  it('needs off-route to persist before rerouting, and holds progress meanwhile', () => {
    const off = 0.001; // ~111 m east of the northbound leg
    const t0 = run(fix(0, north(400), 0), fix(off, north(420), 1));
    expect(t0.events.some((e) => e.type === 'off-route')).toBe(false);
    expect(Math.round(t0.state.lastAlongM)).toBe(400);
    const t1 = run(fix(0, north(400), 0), fix(off, north(420), 1), fix(off, north(440), 1 + cfg.offRouteConfirmSeconds));
    expect(t1.events.at(-1)).toEqual({ type: 'off-route' });
  });

  it('a single GPS glitch back on route clears the off-route timer', () => {
    const off = 0.001;
    const { events } = run(fix(off, north(400), 0), fix(0, north(410), 1), fix(off, north(420), 1 + cfg.offRouteConfirmSeconds - 1));
    expect(events.some((e) => e.type === 'off-route')).toBe(false);
  });

  it('ignores inaccurate fixes entirely', () => {
    const { events, state } = run(fix(0.01, 0, 0, cfg.maxAccuracyM + 1));
    expect(events).toEqual([]);
    expect(state).toEqual(initialTracker);
  });

  it('arrives within the arrival radius, then goes quiet', () => {
    const { events, state } = run(fix(0.01 - 0.0003, 0.01, 0), fix(0.01, 0.01, 1));
    expect(events.filter((e) => e.type === 'arrived')).toHaveLength(1);
    expect(state.arrived).toBe(true);
  });

  it('does not snap backwards beyond the jitter allowance', () => {
    // At 1000 m along, a fix that geometrically matches 900 m is held at >= 1000 - snapBacktrackM.
    const p = computeProgress(idx, fix(0, north(900), 0), 1000, cfg);
    expect(p.alongM).toBeGreaterThanOrEqual(1000 - cfg.snapBacktrackM - 0.5);
  });
});
