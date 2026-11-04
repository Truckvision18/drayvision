import type { Facility, SponsoredListing, TruckEntrance, WaitTimeObservation } from '@drayvision/shared';
import pg from 'pg';
import type { BBox } from '../providers/types.js';
import type { Repository } from './repo.js';

/** SQL fragment: geography column intersects a bbox given as 4 consecutive params starting at `first`. */
function bboxClause(col: string, first: number): string {
  const p = (n: number): string => '$' + String(first + n);
  return `ST_Intersects(${col}, ST_MakeEnvelope(${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, 4326)::geography)`;
}

export class PgRepository implements Repository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
    this.pool.on('error', () => undefined);
  }

  async facilities(bbox: BBox | null): Promise<Facility[]> {
    const where = bbox ? `WHERE ${bboxClause('f.geom', 1)}` : '';
    const { rows } = await this.pool.query(
      `SELECT f.id, f.name, f.kind, ST_X(f.geom::geometry) AS lng, ST_Y(f.geom::geometry) AS lat, f.address,
              f.external_ids, f.requires_twic, f.provenance,
              COALESCE(json_agg(json_build_object('id', e.id, 'label', e.label, 'hours', e.hours, 'notes', e.notes,
                 'provenance', e.provenance,
                 'location', json_build_object('lng', ST_X(e.geom::geometry), 'lat', ST_Y(e.geom::geometry))))
                 FILTER (WHERE e.id IS NOT NULL), '[]') AS entrances
         FROM facilities f LEFT JOIN truck_entrances e ON e.facility_id = f.id
         ${where} GROUP BY f.id ORDER BY f.name`,
      bbox ? [...bbox] : [],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      location: { lng: r.lng, lat: r.lat },
      ...(r.address ? { address: r.address } : {}),
      externalIds: r.external_ids,
      truckEntrances: r.entrances as TruckEntrance[],
      requiresTwic: r.requires_twic,
      provenance: r.provenance,
    }));
  }

  async facility(id: string): Promise<Facility | null> {
    return (await this.facilities(null)).find((f) => f.id === id) ?? null;
  }

  async sponsored(bbox: BBox | null, at: Date): Promise<SponsoredListing[]> {
    const params: unknown[] = [at.toISOString()];
    let where = 'active_from <= $1 AND active_to > $1';
    if (bbox) {
      params.push(...bbox);
      where += ` AND ${bboxClause('geom', 2)}`;
    }
    const { rows } = await this.pool.query(
      `SELECT id, facility_id, title, ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat, active_from, active_to
         FROM sponsored_listings WHERE ${where}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      ...(r.facility_id ? { facilityId: r.facility_id } : {}),
      title: r.title,
      location: { lng: r.lng, lat: r.lat },
      label: 'Sponsored' as const,
      activeFrom: new Date(r.active_from).toISOString(),
      activeTo: new Date(r.active_to).toISOString(),
    }));
  }

  async latestWaitTimes(ids: string[]): Promise<WaitTimeObservation[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (facility_id) facility_id, observed_at, wait_minutes, source
         FROM wait_time_observations WHERE facility_id = ANY($1) ORDER BY facility_id, observed_at DESC`,
      [ids],
    );
    return rows.map((r) => ({
      facilityId: r.facility_id,
      observedAt: new Date(r.observed_at).toISOString(),
      waitMinutes: r.wait_minutes,
      source: r.source,
    }));
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
