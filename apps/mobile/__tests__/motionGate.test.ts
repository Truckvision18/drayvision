import { buildConfig } from '../src/config';
import { checkStale, initialGate, isAllowed, reduceMotion, type GateState, type MotionSample } from '../src/safety/motionGate';

const cfg = buildConfig('dev').safety;
const sample = (t: number, speedMps: number | null, accuracyM = 5): MotionSample => ({ timestamp: t * 1000, speedMps, accuracyM });
const feed = (g: GateState, ...ss: MotionSample[]) => ss.reduce((acc, s) => reduceMotion(acc, s, cfg), g);

describe('motion gate', () => {
  it('starts unknown, which never unlocks gated features', () => {
    expect(initialGate.state).toBe('unknown');
    expect(isAllowed('camera-stills', 'unknown')).toBe(false);
    expect(isAllowed('camera-stills', 'moving')).toBe(false);
    expect(isAllowed('camera-stills', 'parked')).toBe(true);
  });

  it('requires the configured dwell before PARKED', () => {
    const dwell = cfg.parkedDwellSeconds;
    expect(feed(initialGate, sample(0, 0), sample(dwell - 1, 0)).state).toBe('unknown');
    expect(feed(initialGate, sample(0, 0), sample(dwell, 0)).state).toBe('parked');
  });

  it('drops out of PARKED immediately on movement, before MOVING is confirmed', () => {
    const parked = feed(initialGate, sample(0, 0), sample(cfg.parkedDwellSeconds, 0));
    const g = feed(parked, sample(cfg.parkedDwellSeconds + 1, cfg.movingSpeedMps + 1));
    expect(g.state).toBe('unknown');
    expect(isAllowed('preview-gallery', g.state)).toBe(false);
  });

  it('ignores inaccurate fixes and never parks on them', () => {
    const g = feed(initialGate, sample(0, 0, cfg.maxAccuracyM + 1), sample(cfg.parkedDwellSeconds + 1, 0, cfg.maxAccuracyM + 1));
    expect(g.state).toBe('unknown');
  });

  it('creeping in the dead band un-parks', () => {
    const parked = feed(initialGate, sample(0, 0), sample(cfg.parkedDwellSeconds, 0));
    const mid = (cfg.movingSpeedMps + cfg.parkedSpeedMps) / 2;
    expect(feed(parked, sample(cfg.parkedDwellSeconds + 1, mid)).state).toBe('unknown');
  });

  it('goes unknown when samples go stale', () => {
    const parked = feed(initialGate, sample(0, 0), sample(cfg.parkedDwellSeconds, 0));
    expect(checkStale(parked, (cfg.parkedDwellSeconds + cfg.staleAfterSeconds + 1) * 1000, cfg).state).toBe('unknown');
  });
});
