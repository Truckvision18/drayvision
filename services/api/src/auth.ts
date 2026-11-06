import { IdSchema } from '@drayvision/shared';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { HttpError } from './errors.js';

/**
 * Resolve the account a request acts for. Profiles (and everything keyed off them) are
 * per account.
 *
 * - dev-header (dev / test only): the `x-account-id` header names the account.
 * - token (pilot / prod): real sign-in is not built yet, so account-scoped calls fail closed
 *   with 501 rather than trusting a header anyone could set.
 */
export function resolveAccount(req: FastifyRequest, auth: AppConfig['auth']): string {
  if (auth.mode === 'token') {
    throw new HttpError(501, 'NOT_IMPLEMENTED', 'Account sign-in is not built yet; account-scoped endpoints are disabled in this environment.');
  }
  const raw = req.headers['x-account-id'];
  const parsed = IdSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  if (!parsed.success) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing x-account-id header (dev auth).');
  return parsed.data;
}
