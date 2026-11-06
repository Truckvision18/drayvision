import { IdSchema, TruckProfileCreateSchema, TruckProfileUpdateSchema } from '@drayvision/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveAccount } from '../auth.js';
import type { AppContext } from '../context.js';
import { ProfileNotFoundError } from '../profiles/model.js';
import { parseBody } from './schemas.js';

const idParams = z.object({ id: IdSchema });
const versionParams = z.object({ id: IdSchema, version: z.coerce.number().int().min(1) });

/**
 * Truck profiles, stored server-side per account. Devices cache them, keyed by (id, version).
 *
 *   GET    /profiles                         list (default first)
 *   POST   /profiles                         create (may be incomplete) → 201
 *   GET    /profiles/:id                     current version
 *   PATCH  /profiles/:id                     edit; body.expected_version guards concurrent edits (409)
 *   POST   /profiles/:id/default             make default (does not change the version)
 *   DELETE /profiles/:id                     soft delete → 204 (version history kept)
 *   GET    /profiles/:id/versions/:version   exact snapshot a route was computed with
 */
export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { profiles, config } = ctx;
  const account = (req: Parameters<typeof resolveAccount>[0]): string => resolveAccount(req, config.auth);

  app.get('/profiles', async (req) => ({ profiles: await profiles.list(account(req)) }));

  app.post('/profiles', async (req, reply) => {
    const accountId = account(req);
    const input = parseBody(TruckProfileCreateSchema, req.body);
    return reply.code(201).send(await profiles.create(accountId, input, config.profiles.maxPerAccount, ctx.now()));
  });

  app.get('/profiles/:id', async (req) => {
    const accountId = account(req);
    const { id } = parseBody(idParams, req.params);
    const p = await profiles.get(accountId, id);
    if (!p) throw new ProfileNotFoundError(id);
    return p;
  });

  app.patch('/profiles/:id', async (req) => {
    const accountId = account(req);
    const { id } = parseBody(idParams, req.params);
    return profiles.update(accountId, id, parseBody(TruckProfileUpdateSchema, req.body), ctx.now());
  });

  app.post('/profiles/:id/default', async (req) => {
    const accountId = account(req);
    const { id } = parseBody(idParams, req.params);
    return profiles.setDefault(accountId, id, ctx.now());
  });

  app.delete('/profiles/:id', async (req, reply) => {
    const accountId = account(req);
    const { id } = parseBody(idParams, req.params);
    await profiles.delete(accountId, id, ctx.now());
    return reply.code(204).send();
  });

  app.get('/profiles/:id/versions/:version', async (req) => {
    const accountId = account(req);
    const { id, version } = parseBody(versionParams, req.params);
    const p = await profiles.getVersion(accountId, id, version);
    if (!p) throw new ProfileNotFoundError(`${id}@${version}`);
    return p;
  });
}
