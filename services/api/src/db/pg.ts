import { FacilitySchema, SponsoredListingSchema, WaitTimeObservationSchema, type Facility, type SponsoredListing, type WaitTimeObservation } from '@drayvision/shared';
import type pg from 'pg';
import type { BBox } from '../providers/types.js';
import type { Repository } from './repo.js';

/** SQL fragment: geography column intersects a bbox given as 4 consecutive params starting at `first`. */
function bboxClause(col: string, first: number): string {
  const p = (n: number): string => '$' + String(first + n);
  return `ST_Intersects(${col}, ST_MakeEnvelope(${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, 4326)::geography)`;
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

/** Postgres + PostGIS repository. Every row is validated against the shared schemas on read. */
export class PgRepository implements Repository {
  constructor(private readonly pool: pg.Pool) {}

  async facilities(bbox: BBox | null): Promise<Facility[]> {
    const where = bbox ? `WHERE EXISTS (SELECT 1 FROM truck_entrances x WHERE x.facility_id = f.id AND ${bboxClause('x.geom', 1)})` : '';
    const { rows } = await this.pool.query(
      `SELECT f.id, f.name, f.kind, f.street_address, f.verification_state, f.requires_twic,
              f.receiving_office, f.staging_area, f.docks, f.notes,
              COALESCE(json_agg(json_build_object(
                 'id', e.id, 'street', e.street, 'is_primary', e.is_primary, 'verified_by', e.verified_by,
                 'verified_at', e.verified_at, 'source', e.source, 'notes', e.notes,
                 'coords', json_build_object('lng', ST_X(e.geom::geometry), 'lat', ST_Y(e.geom::geometry)))
                 ORDER BY e.is_primary DESC, e.id) FILTER (WHERE e.id IS NOT NULL), '[]') AS entrances
         FROM facilities f LEFT JOIN truck_entrances e ON e.facility_id = f.id
         ${where} GROUP BY f.id ORDER BY f.name`,
      bbox ? [...bbox] : [],
    );
    return rows.map((r) =>
      FacilitySchema.parse({
        id: r.id,
        name: r.name,
        kind: r.kind,
        street_address: r.street_address,
        truck_entrances: (r.entrances as Array<Record<string, unknown>>).map((e) => ({
          ...e,
          verified_at: e.verified_at ? new Date(e.verified_at as string).toISOString() : null,
        })),
        receiving_office: r.receiving_office,
        staging_area: r.staging_area,
        docks: r.docks,
        notes: r.notes,
        verification_state: r.verification_state,
        requires_twic: r.requires_twic,
      }),
    );
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
    return rows.map((r) =>
      SponsoredListingSchema.parse({
        id: r.id,
        facility_id: r.facility_id,
        title: r.title,
        location: { lng: r.lng, lat: r.lat },
        label: 'Sponsored',
        active_from: iso(r.active_from),
        active_to: iso(r.active_to),
      }),
    );
  }

  async latestWaitTimes(ids: string[]): Promise<WaitTimeObservation[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (facility_id) facility_id, observed_at, wait_minutes, source
         FROM wait_time_observations WHERE facility_id = ANY($1) ORDER BY facility_id, observed_at DESC`,
      [ids],
    );
    return rows.map((r) => WaitTimeObservationSchema.parse({ ...r, observed_at: iso(r.observed_at) }));
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
