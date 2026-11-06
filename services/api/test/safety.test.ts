import { SafetyResultSchema, type LineCoordinates } from '@drayvision/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import { validateRoute } from '../src/safety/validate.js';
import { hazard, rig } from './helpers.js';

const safety = loadConfig('test', {}, {}).safety;
const geometry: LineCoordinates = [
  [-74, 40.7],
  [-74, 40.71],
];
const onRoute = { lng: -74, lat: 40.705 };
const offRoute = { lng: -73.99, lat: 40.705 }; // ~840 m east

const run = (...hs: Parameters<typeof hazard>[0][]) => SafetyResultSchema.parse(validateRoute(geometry, rig, hs.map(hazard), safety));

describe('validateRoute (Phase 5) with shared Hazard types', () => {
  it('passes a clean route', () => {
    expect(run().status).toBe('PASS');
  });

  it('LOW_CLEARANCE fails when clearance < height + margin, warns inside the band, clears above it', () => {
    const at = (value: number) => run({ id: 'b', type: 'LOW_CLEARANCE', value, location: onRoute });
    expect(at(rig.height_m + safety.clearanceMarginM - 0.01).status).toBe('FAIL');
    expect(at(rig.height_m + safety.clearanceMarginM + 0.1).status).toBe('WARN');
    const clear = at(rig.height_m + safety.clearanceMarginM + safety.clearanceWarnBandM + 0.5);
    expect(clear.status).toBe('PASS');
    expect(clear.hazards[0]).toMatchObject({ id: 'b', resolved: true, distance_along_route_m: expect.any(Number) });
  });

  it('UNKNOWN_CLEARANCE never passes silently', () => {
    const r = run({ id: 'u', type: 'UNKNOWN_CLEARANCE', location: onRoute });
    expect(r.status).toBe('WARN');
    expect(r.hazards[0]!.resolved).toBe(false);
  });

  it('a low-confidence record can fail a route but never clear one', () => {
    const tall = rig.height_m + 2;
    expect(run({ id: 'b', type: 'LOW_CLEARANCE', value: tall, location: onRoute, confidence: 0.5 }).status).toBe('WARN');
    expect(run({ id: 'b', type: 'LOW_CLEARANCE', value: 3.0, location: onRoute, confidence: 0.5 }).status).toBe('FAIL');
  });

  it('WEIGHT_LIMIT compares gross weight (kg)', () => {
    expect(run({ id: 'w', type: 'WEIGHT_LIMIT', value: 20_000, location: onRoute }).status).toBe('FAIL');
    expect(run({ id: 'w', type: 'WEIGHT_LIMIT', value: 40_000, location: onRoute }).status).toBe('PASS');
  });

  it('TRUCK_RESTRICTION: no trucks / parkway always fail; dimension limits compare the profile', () => {
    expect(run({ id: 't', type: 'TRUCK_RESTRICTION', restriction: 'NO_TRUCKS', location: onRoute }).status).toBe('FAIL');
    expect(run({ id: 'p', type: 'TRUCK_RESTRICTION', restriction: 'PARKWAY', location: onRoute }).status).toBe('FAIL');
    expect(run({ id: 'l', type: 'TRUCK_RESTRICTION', restriction: 'MAX_LENGTH', value: 15, location: onRoute }).status).toBe('FAIL');
    expect(run({ id: 'x', type: 'TRUCK_RESTRICTION', restriction: 'MAX_AXLES', value: 6, location: onRoute }).status).toBe('PASS');
  });

  it('HAZMAT_RESTRICTION only affects trucks carrying a banned class', () => {
    const tunnel = hazard({ id: 'tn', type: 'HAZMAT_RESTRICTION', hazmat_classes: [1, 2, 3], location: onRoute });
    expect(validateRoute(geometry, rig, [tunnel], safety).status).toBe('PASS');
    const loaded = { ...rig, hazmat: { carrying: true, classes: [3 as const] } };
    expect(validateRoute(geometry, loaded, [tunnel], safety).status).toBe('FAIL');
    const other = { ...rig, hazmat: { carrying: true, classes: [8 as const] } };
    expect(validateRoute(geometry, other, [tunnel], safety).status).toBe('PASS');
  });

  it('ignores records outside the match radius and retired (resolved) records', () => {
    expect(run({ id: 'b', type: 'LOW_CLEARANCE', value: 3, location: offRoute }).status).toBe('PASS');
    expect(run({ id: 'b', type: 'LOW_CLEARANCE', value: 3, location: onRoute, resolved: true }).status).toBe('PASS');
  });

  it('honours config margins', () => {
    const strict = { ...safety, clearanceMarginM: 1 };
    const r = validateRoute(geometry, rig, [hazard({ id: 'b', type: 'LOW_CLEARANCE', value: rig.height_m + 0.5, location: onRoute })], strict);
    expect(r.status).toBe('FAIL');
  });
});
