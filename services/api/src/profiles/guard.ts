import { CompleteTruckProfileSchema, profileCompleteness, type CompleteTruckProfile } from '@drayvision/shared';
import type { FastifyRequest } from 'fastify';
import { resolveAccount } from '../auth.js';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { ProfileNotFoundError } from './model.js';

export class ProfileIncompleteError extends HttpError {
  constructor(message: string, missing: ReturnType<typeof profileCompleteness>['missing_fields']) {
    super(422, 'PROFILE_INCOMPLETE', message, { missing_fields: missing });
  }
}

/**
 * The single gate in front of every route / toll / safety call: resolve the caller's account,
 * load the named profile (current version), and refuse unless it is COMPLETE. There is no
 * fallback profile and no default dimensions — an incomplete profile blocks the call with a
 * "complete your truck profile" error listing exactly what is missing.
 */
export async function requireCompleteProfile(
  req: FastifyRequest,
  ctx: AppContext,
  profileId: string,
): Promise<{ accountId: string; profile: CompleteTruckProfile }> {
  const accountId = resolveAccount(req, ctx.config.auth);
  const profile = await ctx.profiles.get(accountId, profileId);
  if (!profile) throw new ProfileNotFoundError(profileId);
  const completeness = profileCompleteness(profile);
  if (!completeness.complete) throw new ProfileIncompleteError(completeness.message!, completeness.missing_fields);
  // Belt and braces: the strict schema must agree before anything reaches an engine.
  return { accountId, profile: CompleteTruckProfileSchema.parse(profile) as CompleteTruckProfile };
}
