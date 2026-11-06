import { cumulativeDistances, type LngLat, type Route, type TileConfig } from '@drayvision/shared';
import { OfflineManager } from '@maplibre/maplibre-react-native';

/**
 * Prefetch base-map tiles for the trip — and ONLY for the trip: the active route corridor plus
 * the destination area. Everything else is left to the on-device ambient cache, which fills
 * as the driver actually views the map.
 *
 * Offline packs are rectangles, so a long diagonal route can't be one pack (its bounding box
 * would cover a huge area off the route). The route is cut into short chunks; each chunk's
 * box, grown by the corridor buffer, becomes a pack. Short chunks keep every pack close to the
 * corridor: a pack corner is at most chunk/2 + √2·buffer off the route (45° worst case).
 * (Low-zoom tiles are inherently wider than the corridor — that's tile granularity, and the
 * reason min_zoom is configurable.) Disabled entirely when the source's terms forbid bulk download.
 */
export type Bounds = [west: number, south: number, east: number, north: number];

export interface PrefetchPack {
  key: string;
  bounds: Bounds;
  minZoom: number;
  maxZoom: number;
  kind: 'corridor' | 'destination';
}

const M_PER_DEG_LAT = 111_320;
const mPerDegLng = (lat: number): number => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Grow a box by `m` metres on every side. */
function grow(b: Bounds, m: number): Bounds {
  const lat = (b[1] + b[3]) / 2;
  const dLng = m / mPerDegLng(lat);
  const dLat = m / M_PER_DEG_LAT;
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat];
}

function bboxOf(points: ReadonlyArray<readonly [number, number]>): Bounds {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [w, s, e, n];
}

const lng2x = (lng: number, z: number): number => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Number of tiles a pack downloads across its zoom range. */
export function tileCount(b: Bounds, minZoom: number, maxZoom: number): number {
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    n += (lng2x(b[2], z) - lng2x(b[0], z) + 1) * (lat2y(b[1], z) - lat2y(b[3], z) + 1);
  }
  return n;
}

/** Cut the route into consecutive pieces no longer than `chunkM` (interpolating long segments). */
function chunks(geometry: Route['geometry'], chunkM: number): Array<Array<[number, number]>> {
  const cum = cumulativeDistances(geometry);
  const total = cum.at(-1) ?? 0;
  const at = (d: number): [number, number] => {
    let i = cum.findIndex((c) => c >= d);
    if (i <= 0) i = 1;
    const a = geometry[i - 1]!;
    const b = geometry[i]!;
    const span = cum[i]! - cum[i - 1]!;
    const t = span === 0 ? 0 : (d - cum[i - 1]!) / span;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out: Array<Array<[number, number]>> = [];
  for (let start = 0; start < total; start += chunkM) {
    const end = Math.min(total, start + chunkM);
    const inner = geometry.filter((_, i) => cum[i]! > start && cum[i]! < end).map((p) => [p[0], p[1]] as [number, number]);
    out.push([at(start), ...inner, at(end)]);
  }
  return out;
}

export function planPrefetch(route: Route, p: TileConfig['prefetch']): PrefetchPack[] {
  if (!p.enabled || route.geometry.length < 2) return [];
  const corridor: PrefetchPack[] = chunks(route.geometry, p.corridor_chunk_m).map((c, i) => ({
    key: `${route.route_id}:c${i}`,
    bounds: grow(bboxOf(c), p.corridor_buffer_m),
    minZoom: p.min_zoom,
    maxZoom: p.max_zoom,
    kind: 'corridor',
  }));
  const d: LngLat = route.destination;
  const destination: PrefetchPack = {
    key: `${route.route_id}:dest`,
    bounds: grow([d.lng, d.lat, d.lng, d.lat], p.destination_radius_m),
    minZoom: p.min_zoom,
    maxZoom: p.max_zoom,
    kind: 'destination',
  };
  // Lower the top zoom of any pack that would exceed the per-pack tile cap.
  const capped = [...corridor, destination].map((pack) => {
    let maxZoom = pack.maxZoom;
    while (maxZoom > pack.minZoom && tileCount(pack.bounds, pack.minZoom, maxZoom) > p.max_tiles_per_pack) maxZoom -= 1;
    return { ...pack, maxZoom };
  });
  // Pack budget: the destination always; corridor from the trip start onward.
  const dest = capped.at(-1)!;
  return [...capped.slice(0, -1).slice(0, Math.max(0, p.max_packs - 1)), dest];
}

/** The bit of OfflineManager we use (injectable for tests). */
export interface OfflineStore {
  getPacks(): Promise<Array<{ id: string; metadata: Record<string, unknown> }>>;
  createPack(options: { mapStyle: string; bounds: Bounds; minZoom: number; maxZoom: number; metadata: Record<string, unknown> }, progress: () => void, error: () => void): Promise<unknown>;
  deletePack(id: string): Promise<void>;
}

/**
 * Make the device's prefetched packs match exactly the current trip: delete any of ours that
 * aren't for this route (old trips, other routes), create the missing ones. `route = null`
 * (no active trip) deletes all of ours. Packs we didn't create are never touched.
 */
export async function syncPrefetch(route: Route | null, tileConfig: TileConfig, offline: OfflineStore = OfflineManager as unknown as OfflineStore): Promise<{ created: number; deleted: number }> {
  const want = route ? planPrefetch(route, tileConfig.prefetch) : [];
  const wantKeys = new Set(want.map((w) => `${w.key}@${tileConfig.config_version}`));
  const existing = (await offline.getPacks()).filter((p) => p.metadata?.dv === 'prefetch');
  let deleted = 0;
  const have = new Set<string>();
  for (const p of existing) {
    const k = `${String(p.metadata.key)}@${String(p.metadata.config_version)}`;
    if (wantKeys.has(k)) have.add(k);
    else {
      await offline.deletePack(p.id);
      deleted += 1;
    }
  }
  let created = 0;
  for (const w of want) {
    if (have.has(`${w.key}@${tileConfig.config_version}`)) continue;
    await offline.createPack(
      {
        mapStyle: tileConfig.style_url,
        bounds: w.bounds,
        minZoom: w.minZoom,
        maxZoom: w.maxZoom,
        metadata: { dv: 'prefetch', key: w.key, kind: w.kind, config_version: tileConfig.config_version },
      },
      () => undefined,
      () => undefined,
    );
    created += 1;
  }
  return { created, deleted };
}
