import type { LineCoordinates, LngLat } from './geo.js';

/**
 * Route geometry math shared by the API safety layer (restriction matching) and the mobile app
 * (snapping GPS to the route for turn-by-turn). One implementation, so "on route" means the
 * same thing on both sides.
 */
const EARTH_R = 6_371_000;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance (m) from the start of the line to each vertex. Same length as `line`. */
export function cumulativeDistances(line: LineCoordinates): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const a = line[i - 1]!;
      const b = line[i]!;
      total += haversineM({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    }
    out.push(total);
  }
  return out;
}

export interface LineProjection {
  /** Perpendicular ("cross-track") distance from the point to the line, metres. */
  distanceM: number;
  /** Distance along the line to the projected point, metres. */
  alongM: number;
  /** Index of the segment [i, i+1] the point projects onto. */
  segmentIndex: number;
  /** The projected (snapped) point on the line. */
  point: LngLat;
}

/**
 * Project a point onto a polyline. Uses a local equirectangular projection around the point —
 * accurate to well under a metre at the tens-of-metres scales we match at.
 *
 * `fromAlongM` limits the search to the line from that distance onward (minus nothing): used by
 * turn-by-turn so a GPS fix can't snap backwards onto an earlier part of a looping route.
 */
export function projectOntoLine(
  p: LngLat,
  line: LineCoordinates,
  opts: { cumulative?: number[]; fromAlongM?: number } = {},
): LineProjection {
  if (line.length === 0) return { distanceM: Number.POSITIVE_INFINITY, alongM: 0, segmentIndex: 0, point: p };
  const first = line[0]!;
  if (line.length === 1) {
    const point = { lng: first[0], lat: first[1] };
    return { distanceM: haversineM(p, point), alongM: 0, segmentIndex: 0, point };
  }
  const cum = opts.cumulative ?? cumulativeDistances(line);
  const fromAlong = opts.fromAlongM ?? 0;
  const cosLat = Math.cos(toRad(p.lat));
  const project = (lng: number, lat: number): [number, number] => [toRad(lng - p.lng) * cosLat * EARTH_R, toRad(lat - p.lat) * EARTH_R];

  let best: LineProjection | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const segEndAlong = cum[i + 1]!;
    if (segEndAlong < fromAlong) continue;
    const a = line[i]!;
    const b = line[i + 1]!;
    const [ax, ay] = project(a[0], a[1]);
    const [bx, by] = project(b[0], b[1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    // Don't let the projection land before the search start within the first eligible segment.
    const segStart = cum[i]!;
    const segLen = segEndAlong - segStart;
    if (segStart < fromAlong && segLen > 0) t = Math.max(t, (fromAlong - segStart) / segLen);
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (best === null || d < best.distanceM) {
      best = {
        distanceM: d,
        alongM: segStart + t * segLen,
        segmentIndex: i,
        point: { lng: a[0] + t * (b[0] - a[0]), lat: a[1] + t * (b[1] - a[1]) },
      };
    }
  }
  return best ?? { distanceM: Number.POSITIVE_INFINITY, alongM: cum.at(-1) ?? 0, segmentIndex: line.length - 2, point: p };
}

/** Back-compat helper: distance to the line and distance along it. */
export function distanceToLine(p: LngLat, line: LineCoordinates): { distanceM: number; alongM: number } {
  const { distanceM, alongM } = projectOntoLine(p, line);
  return { distanceM, alongM };
}
