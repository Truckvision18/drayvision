import type { TruckProfile } from '@drayvision/shared';
import { applyUpdate, byDefaultThenRecent, newProfile, ProfileLimitError, ProfileNotFoundError, type ProfileCreateInput, type ProfileUpdateInput } from './model.js';

/**
 * Server-side truck profile storage, per account. Invariants every implementation keeps:
 *  - an account with ≥1 profile has exactly one default (first profile becomes default;
 *    deleting the default promotes the most recently updated remaining profile);
 *  - every version of a profile stays readable via `getVersion`, even after deletion, so a
 *    route can always show the exact profile it was computed for.
 */
export interface ProfileRepository {
  list(accountId: string): Promise<TruckProfile[]>;
  get(accountId: string, id: string): Promise<TruckProfile | null>;
  getVersion(accountId: string, id: string, version: number): Promise<TruckProfile | null>;
  create(accountId: string, input: ProfileCreateInput, maxPerAccount: number, now: Date): Promise<TruckProfile>;
  update(accountId: string, id: string, patch: ProfileUpdateInput, now: Date): Promise<TruckProfile>;
  setDefault(accountId: string, id: string, now: Date): Promise<TruckProfile>;
  delete(accountId: string, id: string, now: Date): Promise<void>;
}

/** In-memory implementation (tests, and the API when no DATABASE_URL is set). */
export class MemoryProfileRepository implements ProfileRepository {
  private readonly live = new Map<string, TruckProfile>();
  private readonly versions = new Map<string, TruckProfile>(); // `${id}@${version}`

  private mine(accountId: string): TruckProfile[] {
    return [...this.live.values()].filter((p) => p.account_id === accountId);
  }

  private save(p: TruckProfile): TruckProfile {
    this.live.set(p.id, p);
    this.versions.set(`${p.id}@${p.version}`, p);
    return p;
  }

  async list(accountId: string): Promise<TruckProfile[]> {
    return this.mine(accountId).sort(byDefaultThenRecent);
  }

  async get(accountId: string, id: string): Promise<TruckProfile | null> {
    const p = this.live.get(id);
    return p && p.account_id === accountId ? p : null;
  }

  async getVersion(accountId: string, id: string, version: number): Promise<TruckProfile | null> {
    const p = this.versions.get(`${id}@${version}`);
    return p && p.account_id === accountId ? p : null;
  }

  async create(accountId: string, input: ProfileCreateInput, maxPerAccount: number, now: Date): Promise<TruckProfile> {
    const existing = this.mine(accountId);
    if (existing.length >= maxPerAccount) throw new ProfileLimitError(maxPerAccount);
    const makeDefault = existing.length === 0 || input.is_default === true;
    if (makeDefault) for (const p of existing.filter((x) => x.is_default)) this.live.set(p.id, { ...p, is_default: false });
    return this.save(newProfile(accountId, input, makeDefault, now));
  }

  async update(accountId: string, id: string, patch: ProfileUpdateInput, now: Date): Promise<TruckProfile> {
    const current = await this.get(accountId, id);
    if (!current) throw new ProfileNotFoundError(id);
    const { profile, changed } = applyUpdate(current, patch, now);
    return changed ? this.save(profile) : profile;
  }

  async setDefault(accountId: string, id: string, now: Date): Promise<TruckProfile> {
    const target = await this.get(accountId, id);
    if (!target) throw new ProfileNotFoundError(id);
    // The default flag is account state, not part of the truck: no new version.
    for (const p of this.mine(accountId)) {
      if (p.is_default !== (p.id === id)) this.live.set(p.id, { ...p, is_default: p.id === id, updated_at: now.toISOString() });
    }
    return this.live.get(id)!;
  }

  async delete(accountId: string, id: string, _now: Date): Promise<void> {
    const target = await this.get(accountId, id);
    if (!target) throw new ProfileNotFoundError(id);
    this.live.delete(id); // versions are kept for route audit
    if (target.is_default) {
      const [next] = this.mine(accountId).sort(byDefaultThenRecent);
      if (next) this.live.set(next.id, { ...next, is_default: true });
    }
  }
}
