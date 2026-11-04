import type { LineCoordinates, LngLat } from '@drayvision/shared';

const EARTH_R = 6_371_000;
const toRad = (d: number): number => (d * Math.PI) / 180;

/**
 * Distance in metres from a point to a polyline, plus distance along the line to the closest
 * point. Uses a local equirectangular projection — accurate to well under a metre at the
 * hazard-match radii we care about (tens of metres).
 */
export function distanceToLine(p: LngLat, line: LineCoordinates): { distanceM: number; alongM: number } {
  if (line.length === 0) return { distanceM: Number.POSITIVE_INFINITY, alongM: 0 };
  const cosLat = Math.cos(toRad(p.lat));
  const project = (lng: number, lat: number): [number, number] => [toRad(lng - p.lng) * cosLat * EARTH_R, toRad(lat - p.lat) * EARTH_R];
  let best = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let along = 0;
  const first = line[0]!;
  if (line.length === 1) {
    const [x, y] = project(first[0], first[1]);
    return { distanceM: Math.hypot(x, y), alongM: 0 };
  }
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const [ax, ay] = project(a[0], a[1]);
    const [bx, by] = project(b[0], b[1]);
    const dx = bx - ax;
    const dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    const t = segLen === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (segLen * segLen)));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) {
      best = d;
      bestAlong = along + t * segLen;
    }
    along += segLen;
  }
  return { distanceM: best, alongM: bestAlong };
}
