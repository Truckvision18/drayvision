import { TruckProfileSchema } from '@drayvision/shared';
import { describe, expect, it } from 'vitest';
import { ACCOUNT, auth, completeInput, createProfile, OTHER_ACCOUNT, testApp } from './helpers.js';

describe('profiles API: CRUD per account', () => {
  it('creates a complete profile at version 1; the first one becomes the default', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    expect(TruckProfileSchema.parse(p)).toMatchObject({ account_id: ACCOUNT, version: 1, is_default: true, height_m: 4.11 });
    const second = await createProfile(app, { name: 'Reefer tractor' });
    expect(second.is_default).toBe(false);
  });

  it('saves an INCOMPLETE profile (name only) with null dimensions — never defaults', async () => {
    const { app } = testApp();
    const res = await app.inject({ method: 'POST', url: '/profiles', headers: auth(), payload: { name: 'New tractor' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ height_m: null, weight_kg: null, length_m: null, width_m: null, axle_count: null, hazmat: { carrying: null } });
  });

  it('rejects implausible dimensions (unit mistakes) with 400', async () => {
    const { app } = testApp();
    const res = await app.inject({ method: 'POST', url: '/profiles', headers: auth(), payload: { ...completeInput, height_m: 162 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BAD_REQUEST', message: expect.stringMatching(/height_m/) });
  });

  it('lists only the caller’s profiles, default first', async () => {
    const { app } = testApp();
    const a = await createProfile(app);
    await createProfile(app, { name: 'Other fleet' }, OTHER_ACCOUNT);
    const b = await createProfile(app, { name: 'Second', is_default: true });
    const list = (await app.inject({ url: '/profiles', headers: auth() })).json().profiles;
    expect(list.map((p: { id: string }) => p.id)).toEqual([b.id, a.id]);
    expect(list.filter((p: { is_default: boolean }) => p.is_default)).toHaveLength(1);
  });

  it('accounts cannot read, edit or delete each other’s profiles', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const other = auth(OTHER_ACCOUNT);
    expect((await app.inject({ url: `/profiles/${p.id}`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/profiles/${p.id}`, headers: other, payload: { expected_version: 1, name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/profiles/${p.id}`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: `/profiles/${p.id}/versions/1`, headers: other })).statusCode).toBe(404);
  });

  it('requires an account (401) and fails closed when real auth is configured (501)', async () => {
    expect((await testApp().app.inject({ url: '/profiles' })).json()).toMatchObject({ error: 'UNAUTHENTICATED' });
    const { app } = testApp({ config: { auth: { mode: 'token' } } });
    const res = await app.inject({ url: '/profiles', headers: auth() });
    expect(res.statusCode).toBe(501);
  });

  it('enforces the per-account limit from config', async () => {
    const { app } = testApp({ config: { profiles: { maxPerAccount: 2 } } });
    await createProfile(app);
    await createProfile(app);
    const res = await app.inject({ method: 'POST', url: '/profiles', headers: auth(), payload: { name: 'third' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PROFILE_LIMIT_REACHED');
  });

  it('deleting the default promotes another profile; history stays readable', async () => {
    const { app } = testApp();
    const a = await createProfile(app);
    const b = await createProfile(app, { name: 'Spare' });
    expect((await app.inject({ method: 'DELETE', url: `/profiles/${a.id}`, headers: auth() })).statusCode).toBe(204);
    const list = (await app.inject({ url: '/profiles', headers: auth() })).json().profiles;
    expect(list).toEqual([expect.objectContaining({ id: b.id, is_default: true })]);
    expect((await app.inject({ url: `/profiles/${a.id}/versions/1`, headers: auth() })).statusCode).toBe(200);
  });
});

describe('profiles API: versioning', () => {
  const patch = (app: ReturnType<typeof testApp>['app'], id: string, body: object) =>
    app.inject({ method: 'PATCH', url: `/profiles/${id}`, headers: auth(), payload: body });

  it('every edit bumps the version and keeps the previous version as a snapshot', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const v2 = (await patch(app, p.id, { expected_version: 1, height_m: 4.27 })).json();
    expect(v2).toMatchObject({ version: 2, height_m: 4.27 });
    const v1 = (await app.inject({ url: `/profiles/${p.id}/versions/1`, headers: auth() })).json();
    expect(v1).toMatchObject({ version: 1, height_m: 4.11 });
    expect((await app.inject({ url: `/profiles/${p.id}/versions/2`, headers: auth() })).json().height_m).toBe(4.27);
  });

  it('a stale edit from another device gets 409 with the current version — never a silent overwrite', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    await patch(app, p.id, { expected_version: 1, weight_kg: 30_000 });
    const res = await patch(app, p.id, { expected_version: 1, weight_kg: 20_000 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'VERSION_CONFLICT', current_version: 2 });
    expect((await app.inject({ url: `/profiles/${p.id}`, headers: auth() })).json().weight_kg).toBe(30_000);
  });

  it('a no-op save does not create a new version', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    const res = (await patch(app, p.id, { expected_version: 1, height_m: 4.11, name: p.name })).json();
    expect(res.version).toBe(1);
  });

  it('changing the default flag does not change the truck’s version', async () => {
    const { app } = testApp();
    await createProfile(app);
    const b = await createProfile(app, { name: 'B' });
    const res = (await app.inject({ method: 'POST', url: `/profiles/${b.id}/default`, headers: auth() })).json();
    expect(res).toMatchObject({ is_default: true, version: 1 });
  });

  it('rejects unknown fields and patches without expected_version', async () => {
    const { app } = testApp();
    const p = await createProfile(app);
    expect((await patch(app, p.id, { height_m: 4 })).statusCode).toBe(400);
    expect((await patch(app, p.id, { expected_version: 1, version: 9 })).statusCode).toBe(400);
  });
});
