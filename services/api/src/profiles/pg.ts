import { TruckProfileSchema, type TruckProfile } from '@drayvision/shared';
import type pg from 'pg';
import { applyUpdate, newProfile, ProfileLimitError, ProfileNotFoundError, type ProfileCreateInput, type ProfileUpdateInput } from './model.js';
import type { ProfileRepository } from './repo.js';

interface Row {
  id: string;
  account_id: string;
  version: number;
  is_default: boolean;
  data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Rows store the editable fields as jsonb; every read is re-validated against the shared schema. */
function fromRow(r: Row): TruckProfile {
  return TruckProfileSchema.parse({
    ...r.data,
    id: r.id,
    account_id: r.account_id,
    version: r.version,
    is_default: r.is_default,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  });
}

function dataOf(p: TruckProfile): Record<string, unknown> {
  const { id: _i, account_id: _a, version: _v, is_default: _d, created_at: _c, updated_at: _u, ...data } = p;
  return data;
}

const COLS = 'id, account_id, version, is_default, data, created_at, updated_at';

/**
 * Postgres implementation. Each mutation runs in one transaction with the account's profile
 * rows locked (FOR UPDATE), so concurrent edits from two devices serialise and the
 * one-default invariant can't race.
 */
export class PgProfileRepository implements ProfileRepository {
  constructor(private readonly pool: pg.Pool) {}

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  private async insertVersion(c: pg.PoolClient, p: TruckProfile): Promise<void> {
    await c.query('INSERT INTO truck_profile_versions (profile_id, account_id, version, data, created_at) VALUES ($1, $2, $3, $4, $5)', [
      p.id,
      p.account_id,
      p.version,
      dataOf(p),
      p.updated_at,
    ]);
  }

  async list(accountId: string): Promise<TruckProfile[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLS} FROM truck_profiles WHERE account_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, updated_at DESC`,
      [accountId],
    );
    return rows.map(fromRow);
  }

  async get(accountId: string, id: string): Promise<TruckProfile | null> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLS} FROM truck_profiles WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`, [accountId, id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async getVersion(accountId: string, id: string, version: number): Promise<TruckProfile | null> {
    const { rows } = await this.pool.query<Row & { profile_created_at: Date; is_default: boolean }>(
      `SELECT v.profile_id AS id, v.account_id, v.version, v.data, v.created_at AS updated_at,
              p.created_at, COALESCE(p.is_default AND p.deleted_at IS NULL, false) AS is_default
         FROM truck_profile_versions v JOIN truck_profiles p ON p.id = v.profile_id
        WHERE v.account_id = $1 AND v.profile_id = $2 AND v.version = $3`,
      [accountId, id, version],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async create(accountId: string, input: ProfileCreateInput, maxPerAccount: number, now: Date): Promise<TruckProfile> {
    return this.tx(async (c) => {
      const { rows } = await c.query<{ id: string; is_default: boolean }>(
        'SELECT id, is_default FROM truck_profiles WHERE account_id = $1 AND deleted_at IS NULL FOR UPDATE',
        [accountId],
      );
      if (rows.length >= maxPerAccount) throw new ProfileLimitError(maxPerAccount);
      const makeDefault = rows.length === 0 || input.is_default === true;
      if (makeDefault) await c.query('UPDATE truck_profiles SET is_default = false WHERE account_id = $1 AND is_default', [accountId]);
      const p = newProfile(accountId, input, makeDefault, now);
      await c.query(`INSERT INTO truck_profiles (${COLS}) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        p.id,
        p.account_id,
        p.version,
        p.is_default,
        dataOf(p),
        p.created_at,
        p.updated_at,
      ]);
      await this.insertVersion(c, p);
      return p;
    });
  }

  async update(accountId: string, id: string, patch: ProfileUpdateInput, now: Date): Promise<TruckProfile> {
    return this.tx(async (c) => {
      const { rows } = await c.query<Row>(`SELECT ${COLS} FROM truck_profiles WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`, [
        accountId,
        id,
      ]);
      if (!rows[0]) throw new ProfileNotFoundError(id);
      const { profile, changed } = applyUpdate(fromRow(rows[0]), patch, now);
      if (!changed) return profile;
      await c.query('UPDATE truck_profiles SET version = $3, data = $4, updated_at = $5 WHERE account_id = $1 AND id = $2', [
        accountId,
        id,
        profile.version,
        dataOf(profile),
        profile.updated_at,
      ]);
      await this.insertVersion(c, profile);
      return profile;
    });
  }

  async setDefault(accountId: string, id: string, now: Date): Promise<TruckProfile> {
    return this.tx(async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM truck_profiles WHERE account_id = $1 AND deleted_at IS NULL FOR UPDATE', [accountId]);
      if (!rows.some((r) => r.id === id)) throw new ProfileNotFoundError(id);
      // Two statements, in this order: the one-default unique index is checked row by row, so
      // flipping both rows in a single UPDATE can briefly see two defaults and fail.
      await c.query('UPDATE truck_profiles SET is_default = false, updated_at = $3 WHERE account_id = $1 AND is_default AND id <> $2 AND deleted_at IS NULL', [
        accountId,
        id,
        now.toISOString(),
      ]);
      await c.query('UPDATE truck_profiles SET is_default = true, updated_at = $3 WHERE account_id = $1 AND id = $2 AND NOT is_default', [accountId, id, now.toISOString()]);
      const { rows: out } = await c.query<Row>(`SELECT ${COLS} FROM truck_profiles WHERE id = $1`, [id]);
      return fromRow(out[0]!);
    });
  }

  async delete(accountId: string, id: string, now: Date): Promise<void> {
    await this.tx(async (c) => {
      const { rows } = await c.query<{ id: string; is_default: boolean }>(
        'SELECT id, is_default FROM truck_profiles WHERE account_id = $1 AND deleted_at IS NULL FOR UPDATE',
        [accountId],
      );
      const target = rows.find((r) => r.id === id);
      if (!target) throw new ProfileNotFoundError(id);
      // Soft delete: version history stays readable for route audit.
      await c.query('UPDATE truck_profiles SET deleted_at = $3, is_default = false WHERE account_id = $1 AND id = $2', [accountId, id, now.toISOString()]);
      if (target.is_default) {
        await c.query(
          `UPDATE truck_profiles SET is_default = true WHERE id = (
             SELECT id FROM truck_profiles WHERE account_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1)`,
          [accountId],
        );
      }
    });
  }
}
