/**
 * Real Valhalla on the synthetic ladder network (see fixtures/). Started by it.sh; skipped when
 * VALHALLA_IT_URL is not set so the normal unit suite never needs a router.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hazard, LngLat, TruckProfile } from '@drayvision/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../api/config/index.js';
import { ValhallaRouting } from '../../api/src/providers/valhalla.js';
import { distanceToLine } from '../../api/src/safety/geometry.js';
import { provenance, rig, testApp } from '../../api/test/helpers.js';

const URL_ = process.env.VALHALLA_IT_URL;
const here = import.meta.dirname;

interface Ladder {
  snapshotDate: string;
  origin: LngLat;
  rowSpacingDeg: number;
  rowLengthDeg: number;
  rows: Array<{ id: string; tags: Record<string, string> }>;
}
interface Golden {
  cases: Array<{ id: string; row: string; profile: Partial<TruckProfile>; expect: 'avoid' | 'through' }>;
}
const ladder = JSON.parse(readFileSync(resolve(here, '../fixtures/ladder.json'), 'utf8')) as Ladder;
const golden = JSON.parse(readFileSync(resolve(here, '../fixtures/golden.json'), 'utf8')) as Golden;

const rowIndex = (id: string): number => ladder.rows.findIndex((r) => r.id === id);
const rowLat = (id: string): number => ladder.origin.lat + rowIndex(id) * ladder.rowSpacingDeg;
const west = (id: string): LngLat => ({ lng: ladder.origin.lng, lat: rowLat(id) });
const east = (id: string): LngLat => ({ lng: ladder.origin.lng + ladder.rowLengthDeg, lat: rowLat(id) });
/** Midpoint of the row's restricted middle segment. */
const restrictedMid = (id: string): LngLat => ({ lng: ladder.origin.lng + ladder.rowLengthDeg / 2, lat: rowLat(id) });
/** Within this distance of the midpoint means the route used the segment (rows are ~1.1 km apart). */
const ON_SEGMENT_M = 20;

const config = loadConfig('test', {}, {});
const valhalla = (): ValhallaRouting =>
  new ValhallaRouting({
    baseUrl: URL_!,
    timeoutMs: 10_000,
    alternates: config.routing.alternates,
    truckCosting: config.routing.truckCosting,
    graphVersion: ladder.snapshotDate,
  });

describe.skipIf(!URL_)('Valhalla truck routing on the synthetic ladder (real engine)', () => {
  it('reports the dated extract as the graph version', async () => {
    expect(await valhalla().status()).toEqual({ up: true, graphVersion: ladder.snapshotDate });
  });

  it.each(golden.cases)('$id → $expect', async (c) => {
    const routes = await valhalla().route({ origin: west(c.row), destination: east(c.row), profile: { ...rig, ...c.profile } });
    expect(routes.length).toBeGreaterThan(0);
    const [best] = routes;
    const usesSegment = distanceToLine(restrictedMid(c.row), best!.geometry).distanceM < ON_SEGMENT_M;
    expect(usesSegment).toBe(c.expect === 'through');
    // For "avoid" cases, NO alternative may use the restricted segment either.
    if (c.expect === 'avoid') {
      for (const r of routes) expect(distanceToLine(restrictedMid(c.row), r.geometry).distanceM).toBeGreaterThan(ON_SEGMENT_M);
    }
  });

  it('produces turn-by-turn maneuvers with shape indices that cover the geometry', async () => {
    const [r] = await valhalla().route({ origin: west('low-bridge'), destination: east('low-bridge'), profile: rig });
    const ms = r!.legs.flatMap((l) => l.maneuvers);
    expect(ms[0]?.type).toBe('depart');
    expect(ms.at(-1)?.type).toBe('arrive');
    expect(ms.some((m) => m.type === 'left' || m.type === 'right')).toBe(true);
    expect(ms.every((m) => m.verbalInstruction)).toBe(true);
    expect(ms.at(-1)?.endShapeIndex).toBe(r!.geometry.length - 1);
    for (let i = 1; i < ms.length; i++) expect(ms[i]!.beginShapeIndex).toBe(ms[i - 1]!.endShapeIndex);
  });

  describe('through the API (engine + independent safety layer)', () => {
    // Our verified-restrictions layer, mirroring the fixture's tags.
    const restrictions: Hazard[] = [
      { id: 'fx-low-bridge', kind: 'low-clearance', severity: 'blocking', limit: 3.5, location: restrictedMid('low-bridge'), description: 'fixture bridge', provenance },
      { id: 'fx-no-trucks', kind: 'truck-prohibited', severity: 'blocking', location: restrictedMid('no-trucks'), description: 'fixture hgv=no', provenance },
    ];

    it('returns only validated routes, all clear of the bridge', async () => {
      const { app } = testApp({ providers: { routing: valhalla() }, restrictions });
      const res = await app.inject({ method: 'POST', url: '/route', payload: { origin: west('low-bridge'), destination: east('low-bridge'), profile: rig } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.routes.length).toBeGreaterThan(0);
      for (const r of body.routes) {
        expect(r.validation.status).not.toBe('fail');
        expect(r.graphVersion).toBe(ladder.snapshotDate);
      }
    });

    it('safety layer catches a restriction the engine was not told about', async () => {
      // A 3.0 m rig is legal under the bridge per OSM, but our verified dataset says 3.2 m here.
      const stricter: Hazard[] = [{ ...restrictions[0]!, limit: 3.2 }];
      const { app } = testApp({ providers: { routing: valhalla() }, restrictions: stricter });
      const res = await app.inject({
        method: 'POST',
        url: '/route',
        payload: { origin: west('low-bridge'), destination: east('low-bridge'), profile: { ...rig, heightM: 3.0 } },
      });
      const body = res.json();
      const through = [...body.routes, ...body.rejected.map((r: { id: string }) => r)];
      expect(through.length).toBeGreaterThan(0);
      // The direct route goes under the bridge; with 3.0 m + 0.15 m margin > 3.2 m? No: 3.15 < 3.2 → warn band.
      // So it must NOT pass silently: either rejected, or flagged with a warning.
      const direct = body.routes.find((r: { hazards: Array<{ id: string }> }) => r.hazards.some((h) => h.id === 'fx-low-bridge'));
      if (direct) expect(direct.validation.status).toBe('warn');
    });

    it('answers 422 when a point is off the road network', async () => {
      const { app } = testApp({ providers: { routing: valhalla() } });
      const res = await app.inject({ method: 'POST', url: '/route', payload: { origin: { lng: 5, lat: 5 }, destination: east('low-bridge'), profile: rig } });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(/No truck-legal route/);
    });
  });
});
