/**
 * One behaviour suite, run against every ProfileRepository implementation, so the in-memory
 * store used in tests can never drift from the Postgres store used in dev / pilot.
 * The Postgres run is opt-in: set PG_IT_URL (e.g. the compose db) — `make test-pg`.
 */
import { randomUUID } from 'node:crypto';
import { TruckProfileCreateSchema, TruckProfileSchema, TruckProfileUpdateSchema } from '@drayvision/shared';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgProfileRepository } from '../src/profiles/pg.js';
import { MemoryProfileRepository, type ProfileRepository } from '../src/profiles/repo.js';
import { completeInput } from './helpers.js';

const create = (over: object = {}) => TruckProfileCreateSchema.parse({ ...completeInput, ...over });
const update = (body: object) => TruckProfileUpdateSchema.parse(body);
const clock = () => {
  let t = Date.UTC(2026, 10, 6, 12);
  return () => new Date((t += 1000));
};

function behaviour(name: string, makeRepo: () => ProfileRepository): void {
  describe(`ProfileRepository behaviour: ${name}`, () => {
    // Fresh account per test → no cleanup needed, tests can run against a shared DB.
    const acct = () => `it-${randomUUID()}`;

    it('create → read back exactly, validated against the shared schema', async () => {
      const repo = makeRepo();
      const now = clock();
      const a = acct();
      const p = await repo.create(a, create(), 20, now());
      expect(TruckProfileSchema.parse(p)).toEqual(p);
      expect(await repo.get(a, p.id)).toEqual(p);
      expect(await repo.get(acct(), p.id)).toBeNull(); // other account
    });

    it('keeps exactly one default per account', async () => {
      const repo = makeRepo();
      const now = clock();
      const a = acct();
      const p1 = await repo.create(a, create({ name: 'one' }), 20, now());
      const p2 = await repo.create(a, create({ name: 'two', is_default: true }), 20, now());
      let list = await repo.list(a);
      expect(list.map((p) => [p.id, p.is_default])).toEqual([
        [p2.id, true],
        [p1.id, false],
      ]);
      await repo.setDefault(a, p1.id, now());
      list = await repo.list(a);
      expect(list.filter((p) => p.is_default).map((p) => p.id)).toEqual([p1.id]);
      await repo.delete(a, p1.id, now());
      list = await repo.list(a);
      expect(list.map((p) => [p.id, p.is_default])).toEqual([[p2.id, true]]);
    });

    it('versions every change, keeps snapshots, rejects stale edits', async () => {
      const repo = makeRepo();
      const now = clock();
      const a = acct();
      const p = await repo.create(a, create(), 20, now());
      const v2 = await repo.update(a, p.id, update({ expected_version: 1, height_m: 4.27, transponders: [] }), now());
      expect(v2).toMatchObject({ version: 2, height_m: 4.27, transponders: [] });
      await expect(repo.update(a, p.id, update({ expected_version: 1, height_m: 4.0 }), now())).rejects.toMatchObject({ code: 'VERSION_CONFLICT', extra: { current_version: 2 } });
      const noop = await repo.update(a, p.id, update({ expected_version: 2, height_m: 4.27 }), now());
      expect(noop.version).toBe(2);
      expect((await repo.getVersion(a, p.id, 1))?.height_m).toBe(4.11);
      expect((await repo.getVersion(a, p.id, 2))?.height_m).toBe(4.27);
      expect(await repo.getVersion(a, p.id, 3)).toBeNull();
    });

    it('enforces the per-account limit', async () => {
      const repo = makeRepo();
      const now = clock();
      const a = acct();
      await repo.create(a, create(), 2, now());
      await repo.create(a, create(), 2, now());
      await expect(repo.create(a, create(), 2, now())).rejects.toMatchObject({ code: 'PROFILE_LIMIT_REACHED' });
    });

    it('deleted profiles disappear but their versions remain readable', async () => {
      const repo = makeRepo();
      const now = clock();
      const a = acct();
      const p = await repo.create(a, create(), 20, now());
      await repo.delete(a, p.id, now());
      expect(await repo.get(a, p.id)).toBeNull();
      expect(await repo.list(a)).toEqual([]);
      expect((await repo.getVersion(a, p.id, 1))?.name).toBe(completeInput.name);
      await expect(repo.update(a, p.id, update({ expected_version: 1, name: 'x' }), now())).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    });

    it('stores drafts with null dimensions intact (no defaults sneak in)', async () => {
      const repo = makeRepo();
      const a = acct();
      const p = await repo.create(a, TruckProfileCreateSchema.parse({ name: 'draft' }), 20, clock()());
      expect(await repo.get(a, p.id)).toMatchObject({ height_m: null, weight_kg: null, hazmat: { carrying: null, classes: [] } });
    });
  });
}

behaviour('memory', () => new MemoryProfileRepository());

const PG_URL = process.env.PG_IT_URL;
if (PG_URL) {
  const pool = new pg.Pool({ connectionString: PG_URL, max: 4 });
  afterAll(() => pool.end());
  behaviour('postgres', () => new PgProfileRepository(pool));

  describe('postgres: concurrent edits from two devices', () => {
    it('serialise — exactly one wins, the other gets VERSION_CONFLICT', async () => {
      const repo = new PgProfileRepository(pool);
      const a = `it-${randomUUID()}`;
      const p = await repo.create(a, create(), 20, new Date());
      const results = await Promise.allSettled([
        repo.update(a, p.id, update({ expected_version: 1, height_m: 4.2 }), new Date()),
        repo.update(a, p.id, update({ expected_version: 1, height_m: 4.3 }), new Date()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'VERSION_CONFLICT' } });
      expect((await repo.get(a, p.id))?.version).toBe(2);
    });
  });
} else {
  describe.skip('ProfileRepository behaviour: postgres (set PG_IT_URL to run)', () => {
    it('skipped', () => undefined);
  });
}
