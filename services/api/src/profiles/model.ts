import { randomUUID } from 'node:crypto';
import {
  TruckProfileSchema,
  type TruckProfile,
  type TruckProfileCreateSchema,
  type TruckProfileUpdateSchema,
} from '@drayvision/shared';
import type { z } from 'zod';
import { HttpError } from '../errors.js';

export type ProfileCreateInput = z.output<typeof TruckProfileCreateSchema>;
export type ProfileUpdateInput = z.output<typeof TruckProfileUpdateSchema>;

/** Fields that define what the truck IS. Changing any of them creates a new version. */
const VERSIONED_FIELDS = ['name', 'height_m', 'weight_kg', 'length_m', 'width_m', 'axle_count', 'hazmat', 'transponders', 'home_terminal'] as const;

export class ProfileNotFoundError extends HttpError {
  constructor(id: string) {
    super(404, 'PROFILE_NOT_FOUND', `Truck profile ${id} not found`);
  }
}

export class VersionConflictError extends HttpError {
  constructor(expected: number, current: number) {
    super(409, 'VERSION_CONFLICT', `Profile was changed elsewhere (you edited version ${expected}, current is ${current}). Reload and try again.`, {
      current_version: current,
    });
  }
}

export class ProfileLimitError extends HttpError {
  constructor(max: number) {
    super(409, 'PROFILE_LIMIT_REACHED', `An account can save at most ${max} truck profiles.`);
  }
}

export function newProfile(accountId: string, input: ProfileCreateInput, isDefault: boolean, now: Date): TruckProfile {
  const ts = now.toISOString();
  const { is_default: _ignored, ...fields } = input;
  return TruckProfileSchema.parse({ id: randomUUID(), account_id: accountId, version: 1, ...fields, is_default: isDefault, created_at: ts, updated_at: ts });
}

/**
 * Apply a PATCH. Optimistic concurrency: `expected_version` must equal the current version.
 * Returns `changed: false` (and the profile untouched, version NOT bumped) when the patch
 * doesn't actually change anything — so a no-op save never invalidates cached routes.
 */
export function applyUpdate(current: TruckProfile, patch: ProfileUpdateInput, now: Date): { profile: TruckProfile; changed: boolean } {
  if (patch.expected_version !== current.version) throw new VersionConflictError(patch.expected_version, current.version);
  const next: Record<string, unknown> = { ...current };
  let changed = false;
  for (const f of VERSIONED_FIELDS) {
    const v = patch[f];
    if (v === undefined) continue;
    if (JSON.stringify(v) !== JSON.stringify(current[f])) {
      next[f] = v;
      changed = true;
    }
  }
  if (!changed) return { profile: current, changed: false };
  return {
    profile: TruckProfileSchema.parse({ ...next, version: current.version + 1, updated_at: now.toISOString() }),
    changed: true,
  };
}

/** Sort: default first, then most recently updated. */
export const byDefaultThenRecent = (a: TruckProfile, b: TruckProfile): number =>
  Number(b.is_default) - Number(a.is_default) || b.updated_at.localeCompare(a.updated_at);
