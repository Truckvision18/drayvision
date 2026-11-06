import type { CompleteTruckProfile, Facility, Hazard, HazardInput, TruckProfile, TruckProfileCreate } from '@drayvision/shared';
import { HazardSchema } from '@drayvision/shared';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig, type DeepPartial } from '../config/index.js';
import { buildApp } from '../src/app.js';
import { MemoryCache } from '../src/cache/cache.js';
import { Meter } from '../src/cache/meter.js';
import type { AppContext } from '../src/context.js';
import { MemoryRepository } from '../src/db/repo.js';
import { MemoryProfileRepository } from '../src/profiles/repo.js';
import { mockProviders, type Providers } from '../src/providers/index.js';

export const ACCOUNT = 'acct-test-1';
export const OTHER_ACCOUNT = 'acct-test-2';
export const auth = (account = ACCOUNT): Record<string, string> => ({ 'x-account-id': account });

/** A complete 40' container rig (13'6", 80,000 lb). */
export const completeInput: TruckProfileCreate = {
  name: "40' box on chassis",
  height_m: 4.11,
  weight_kg: 36_000,
  length_m: 21.0,
  width_m: 2.59,
  axle_count: 5,
  hazmat: { carrying: false, classes: [] },
  transponders: [{ network: 'E_ZPASS', label: null }],
  home_terminal: null,
};

/** A fully-formed CompleteTruckProfile for pure unit tests (no API round-trip). */
export const rig: CompleteTruckProfile = {
  id: 'rig-1',
  account_id: ACCOUNT,
  version: 1,
  name: "40' box on chassis",
  height_m: 4.11,
  weight_kg: 36_000,
  length_m: 21.0,
  width_m: 2.59,
  axle_count: 5,
  hazmat: { carrying: false, classes: [] },
  transponders: [],
  home_terminal: null,
  is_default: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export const source = {
  kind: 'OFFICIAL' as const,
  name: 'test fixture',
  dataset_version: 'fx-1',
  retrieved_at: '2026-01-01T00:00:00Z',
  rights_id: 'osm',
};

export function hazard(over: Partial<HazardInput> & Pick<HazardInput, 'id' | 'type' | 'location'>): Hazard {
  return HazardSchema.parse({ value: null, description: over.id, source, confidence: 1, resolved: false, ...over });
}

/** Port terminal with a verified primary truck entrance away from its street address. */
export const facility: Facility = {
  id: 'fac-1',
  name: 'Fixture Terminal',
  kind: 'PORT_TERMINAL',
  street_address: '1 Fixture Way, Port Newark, NJ',
  truck_entrances: [
    {
      id: 'fac-1-gate-b',
      coords: { lng: -74.1, lat: 40.67 },
      street: 'Corbin St',
      is_primary: true,
      verified_by: 'ops@drayvision',
      verified_at: '2026-01-01T00:00:00.000Z',
      source: 'OFFICIAL',
      notes: null,
    },
  ],
  receiving_office: null,
  staging_area: null,
  docks: [],
  notes: [],
  verification_state: 'VERIFIED',
  requires_twic: true,
};

/** A facility we know exists but have no truck entrance for — routing must refuse it. */
export const noEntranceFacility: Facility = { ...facility, id: 'fac-2', name: 'Unmapped Warehouse', kind: 'WAREHOUSE', truck_entrances: [], verification_state: 'UNVERIFIED' };

export function testContext(
  opts: { config?: DeepPartial<AppConfig>; providers?: Partial<Providers>; restrictions?: Hazard[]; facilities?: Facility[] } = {},
): AppContext {
  const config = loadConfig('test', opts.config ?? {}, {});
  const facilities = opts.facilities ?? [facility, noEntranceFacility];
  let tick = 0;
  return {
    config,
    providers: { ...mockProviders, ...opts.providers },
    cache: new MemoryCache(config.cache.memoryMaxEntries),
    meter: new Meter(config.budgets),
    repo: new MemoryRepository(facilities),
    profiles: new MemoryProfileRepository(),
    data: {
      restrictions: opts.restrictions ?? [],
      restrictionsVersion: 'test-restrictions-1',
      facilities,
      facilitiesVersion: 'test-facilities-1',
      routingGraphVersion: 'not-built',
    },
    build: { version: '0.1.0', gitSha: 'test' },
    external: { db: false, cache: false },
    // Strictly increasing clock so updated_at ordering is deterministic.
    now: () => new Date(Date.UTC(2026, 10, 6, 12, 0, 0) + tick++ * 1000),
  };
}

export const testApp = (opts: Parameters<typeof testContext>[0] = {}) => {
  const ctx = testContext(opts);
  return { ctx, app: buildApp(ctx) };
};

/** Create a profile through the real API and return it. */
export async function createProfile(app: FastifyInstance, input: Partial<TruckProfileCreate> = completeInput, account = ACCOUNT): Promise<TruckProfile> {
  const res = await app.inject({ method: 'POST', url: '/profiles', headers: auth(account), payload: { ...completeInput, ...input } });
  if (res.statusCode !== 201) throw new Error(`createProfile failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

export const DEPARTURE = '2026-11-06T13:00:00.000Z';
export const origin = { lng: -74.0, lat: 40.7 };
export const destination = { lng: -74.0, lat: 40.71 };
