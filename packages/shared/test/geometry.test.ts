import { describe, expect, it } from 'vitest';
import { cumulativeDistances, haversineM, projectOntoLine } from '../src/index.js';

// A straight north-south line, 0.01° lat ≈ 1112 m, then back south (a loop-back / U-shape).
const line = [
  [0, 0],
  [0, 0.01],
  [0.0005, 0.01],
  [0.0005, 0],
] as const;

describe('geometry', () => {
  it('haversine ~ 1112 m per 0.01° latitude', () => {
    expect(haversineM({ lng: 0, lat: 0 }, { lng: 0, lat: 0.01 })).toBeCloseTo(1112, -1);
  });

  it('cumulative distances are monotonic and start at 0', () => {
    const c = cumulativeDistances(line);
    expect(c[0]).toBe(0);
    expect(c[3]).toBeGreaterThan(c[2]!);
    expect(c[1]).toBeCloseTo(1112, -1);
  });

  it('projects onto the nearest segment with cross-track and along distances', () => {
    const p = projectOntoLine({ lng: -0.0001, lat: 0.005 }, line);
    expect(p.segmentIndex).toBe(0);
    expect(p.distanceM).toBeCloseTo(11.1, 0);
    expect(p.alongM).toBeCloseTo(556, -1);
    expect(p.point.lng).toBeCloseTo(0, 9);
  });

  it('fromAlongM prevents snapping back onto an earlier, parallel part of the route', () => {
    // Point sits between the outbound and return legs, slightly closer to the outbound leg.
    const pt = { lng: 0.0002, lat: 0.005 };
    expect(projectOntoLine(pt, line).segmentIndex).toBe(0);
    const c = cumulativeDistances(line);
    expect(projectOntoLine(pt, line, { cumulative: c, fromAlongM: c[2]! }).segmentIndex).toBe(2);
  });

  it('handles degenerate lines', () => {
    expect(projectOntoLine({ lng: 0, lat: 0 }, []).distanceM).toBe(Number.POSITIVE_INFINITY);
    expect(projectOntoLine({ lng: 0, lat: 0.001 }, [[0, 0]]).distanceM).toBeCloseTo(111, 0);
  });
});
