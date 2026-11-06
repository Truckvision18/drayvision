import { projectOntoLine, RouteSchema, type Route } from '@drayvision/shared';
import { planPrefetch, syncPrefetch, tileCount, type Bounds, type OfflineStore } from '../src/map/prefetch';
import { tileConfigFixture } from './fakeApi';
import { lRoute } from './fixtures';

const cfg = tileConfigFixture('self-hosted'); // prefetch allowed
const p = cfg.prefetch;

/** A ~28 km diagonal route (SW → NE) — the worst case for rectangular packs. */
const diagonal: Route = RouteSchema.parse({
  ...lRoute(),
  route_id: 'diag',
  geometry: [
    [-74.2, 40.6],
    [-74.0, 40.75],
    [-73.95, 40.78],
  ],
  destination: { lng: -73.95, lat: 40.78 },
});

const corners = (b: Bounds) => [
  { lng: b[0], lat: b[1] },
  { lng: b[0], lat: b[3] },
  { lng: b[2], lat: b[1] },
  { lng: b[2], lat: b[3] },
];

describe('corridor prefetch planner', () => {
  it('is off when the tile source’s terms forbid bulk download (MapTiler without an agreement)', () => {
    expect(planPrefetch(diagonal, tileConfigFixture('maptiler').prefetch)).toEqual([]);
  });

  it('never prefetches outside the route corridor + destination area', () => {
    const packs = planPrefetch(diagonal, p);
    expect(packs.length).toBeGreaterThan(5);
    for (const pack of packs) {
      for (const c of corners(pack.bounds)) {
        const fromRoute = projectOntoLine(c, diagonal.geometry).distanceM;
        if (pack.kind === 'corridor') {
          // Worst case (45° diagonal, or a bend inside a chunk): a pack corner sits chunk/2 + √2·buffer
          // off the route line. 2% tolerance: packs are grown with a flat metres-per-degree
          // approximation, while this check measures great-circle distance.
          expect(fromRoute).toBeLessThanOrEqual((p.corridor_chunk_m / 2 + Math.SQRT2 * p.corridor_buffer_m) * 1.02);
        } else {
          const toDest = projectOntoLine(c, [[diagonal.destination.lng, diagonal.destination.lat]]).distanceM;
          expect(toDest).toBeLessThan(p.destination_radius_m * Math.SQRT2 * 1.01);
        }
      }
    }
  });

  it('short chunks keep the prefetched area close to the corridor, unlike one big bounding box', () => {
    const area = (b: Bounds) => (b[2] - b[0]) * (b[3] - b[1]);
    const packs = planPrefetch(diagonal, p).filter((x) => x.kind === 'corridor');
    const oneBox: Bounds = [-74.2, 40.6, -73.95, 40.78];
    expect(packs.reduce((s, x) => s + area(x.bounds), 0)).toBeLessThan(area(oneBox) / 3);
  });

  it('covers the whole route (every chunk end is in some pack) and always includes the destination', () => {
    const packs = planPrefetch(diagonal, p);
    const inside = (pt: readonly [number, number]) => packs.some((k) => pt[0] >= k.bounds[0] && pt[0] <= k.bounds[2] && pt[1] >= k.bounds[1] && pt[1] <= k.bounds[3]);
    for (const pt of diagonal.geometry) expect(inside(pt)).toBe(true);
    expect(packs.at(-1)?.kind).toBe('destination');
  });

  it('respects the per-pack tile cap (by trimming top zoom) and the pack budget', () => {
    const tight = planPrefetch(diagonal, { ...p, max_tiles_per_pack: 60, max_packs: 4 });
    expect(tight).toHaveLength(4);
    expect(tight.at(-1)?.kind).toBe('destination');
    for (const k of tight) expect(tileCount(k.bounds, k.minZoom, k.maxZoom)).toBeLessThanOrEqual(60);
  });
});

describe('prefetch executor', () => {
  function fakeOffline(initial: Array<{ id: string; metadata: Record<string, unknown> }> = []) {
    let packs = [...initial];
    let n = 0;
    const store: OfflineStore & { packs: () => typeof packs } = {
      getPacks: jest.fn(async () => packs),
      createPack: jest.fn(async (o) => {
        packs.push({ id: `p${n++}`, metadata: o.metadata });
      }),
      deletePack: jest.fn(async (id: string) => {
        packs = packs.filter((x) => x.id !== id);
      }),
      packs: () => packs,
    };
    return store;
  }

  it('creates exactly the planned packs for the trip, with the current style URL', async () => {
    const off = fakeOffline();
    const r = await syncPrefetch(diagonal, cfg, off);
    expect(r.created).toBe(planPrefetch(diagonal, p).length);
    expect(off.createPack).toHaveBeenCalledWith(expect.objectContaining({ mapStyle: cfg.style_url, minZoom: 10 }), expect.any(Function), expect.any(Function));
  });

  it('is idempotent, replaces packs on a new route, and removes them all when the trip ends', async () => {
    const off = fakeOffline([{ id: 'theirs', metadata: { app: 'something else' } }]);
    await syncPrefetch(diagonal, cfg, off);
    expect((await syncPrefetch(diagonal, cfg, off)).created).toBe(0);
    const other = RouteSchema.parse({ ...lRoute('other'), route_id: 'other' });
    const r = await syncPrefetch(other, cfg, off);
    expect(r.deleted).toBe(planPrefetch(diagonal, p).length);
    expect(off.packs().filter((x) => x.metadata.dv === 'prefetch').every((x) => String(x.metadata.key).startsWith('other:'))).toBe(true);
    await syncPrefetch(null, cfg, off);
    expect(off.packs()).toEqual([{ id: 'theirs', metadata: { app: 'something else' } }]); // never touches packs it didn't create
  });

  it('a tile-source switch (new config version) re-downloads from the new source', async () => {
    const off = fakeOffline();
    await syncPrefetch(diagonal, cfg, off);
    const r = await syncPrefetch(diagonal, { ...cfg, config_version: 'v-new', style_url: 'http://api.test/tiles/self-hosted-2/style.json' }, off);
    expect(r.deleted).toBeGreaterThan(0);
    expect(r.created).toBe(r.deleted);
  });

  it('MapTiler (no bulk-download agreement): prefetch deletes ours and creates nothing', async () => {
    const off = fakeOffline();
    await syncPrefetch(diagonal, cfg, off);
    const r = await syncPrefetch(diagonal, tileConfigFixture('maptiler'), off);
    expect(r).toEqual({ created: 0, deleted: planPrefetch(diagonal, p).length });
  });
});
