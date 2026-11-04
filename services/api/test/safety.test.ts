import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import type { RawRoute } from '../src/providers/types.js';
import { distanceToLine } from '../src/safety/geometry.js';
import { validateRoute } from '../src/safety/validate.js';
import { hazard, rig } from './helpers.js';

const safety = loadConfig('test', {}, {}).safety;
const route: RawRoute = {
  id: 'r',
  profileId: rig.id,
  origin: { lng: -74, lat: 40.7 },
  destination: { lng: -74, lat: 40.71 },
  geometry: [
    [-74, 40.7],
    [-74, 40.71],
  ],
  distanceM: 1112,
  durationS: 100,
  legs: [],
  graphVersion: 'test',
};
const onRoute = { lng: -74, lat: 40.705 };
const offRoute = { lng: -73.99, lat: 40.705 }; // ~840 m east

describe('distanceToLine', () => {
  it('measures perpendicular distance and distance along', () => {
    const d = distanceToLine({ lng: -74.0001, lat: 40.705 }, route.geometry);
    expect(d.distanceM).toBeGreaterThan(7);
    expect(d.distanceM).toBeLessThan(10);
    expect(d.alongM).toBeCloseTo(556, -1);
  });
});

describe('validateRoute (Phase 5)', () => {
  const run = (...hs: Parameters<typeof hazard>[0][]) => validateRoute(route, rig, hs.map(hazard), 'v1', safety);

  it('passes a clean route', () => {
    expect(run().validation.status).toBe('pass');
  });

  it('fails when clearance < rig height + margin', () => {
    const r = run({ id: 'b', kind: 'low-clearance', limit: rig.heightM + safety.clearanceMarginM - 0.01, location: onRoute });
    expect(r.validation.status).toBe('fail');
  });

  it('warns inside the clearance warning band', () => {
    const r = run({ id: 'b', kind: 'low-clearance', limit: rig.heightM + safety.clearanceMarginM + 0.1, location: onRoute });
    expect(r.validation.status).toBe('warn');
  });

  it('warns on unknown clearance rather than silently passing', () => {
    expect(run({ id: 'b', kind: 'low-clearance', location: onRoute }).validation.status).toBe('warn');
  });

  it('ignores restrictions outside the match radius', () => {
    expect(run({ id: 'b', kind: 'low-clearance', limit: 3, location: offRoute }).validation.status).toBe('pass');
  });

  it('fails on weight limits, truck prohibitions and parkways', () => {
    expect(run({ id: 'w', kind: 'weight-limit', limit: 20_000, location: onRoute }).validation.status).toBe('fail');
    expect(run({ id: 't', kind: 'truck-prohibited', location: onRoute }).validation.status).toBe('fail');
    expect(run({ id: 'p', kind: 'parkway', location: onRoute }).validation.status).toBe('fail');
  });

  it('blocks hazmat through tunnels but only warns otherwise', () => {
    expect(run({ id: 'tn', kind: 'tunnel', location: onRoute }).validation.status).toBe('warn');
    const hz = validateRoute(route, { ...rig, hazmat: [3] }, [hazard({ id: 'tn', kind: 'tunnel', location: onRoute })], 'v1', safety);
    expect(hz.validation.status).toBe('fail');
  });

  it('honours config margins', () => {
    const strict = { ...safety, clearanceMarginM: 1 };
    const r = validateRoute(route, rig, [hazard({ id: 'b', kind: 'low-clearance', limit: rig.heightM + 0.5, location: onRoute })], 'v1', strict);
    expect(r.validation.status).toBe('fail');
  });
});
