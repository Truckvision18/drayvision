import type { Facility, Hazard, TruckProfile } from '@drayvision/shared';
import { loadConfig, type AppConfig, type DeepPartial } from '../config/index.js';
import { buildApp } from '../src/app.js';
import { MemoryCache } from '../src/cache/cache.js';
import { Meter } from '../src/cache/meter.js';
import type { AppContext } from '../src/context.js';
import { MemoryRepository } from '../src/db/repo.js';
import { mockProviders, type Providers } from '../src/providers/index.js';

export const rig: TruckProfile = {
  id: 'std-40',
  name: '40ft box on chassis',
  heightM: 4.11,
  widthM: 2.59,
  lengthM: 20.7,
  grossWeightKg: 36_000,
  axleCount: 5,
  chassis: '40ft',
  hazmat: [],
  twic: true,
};

export const provenance = { source: 'test-fixture', sourceVersion: '1', retrievedAt: '2026-01-01T00:00:00Z', rightsId: 'osm' };

export function hazard(over: Partial<Hazard> & Pick<Hazard, 'id' | 'kind' | 'location'>): Hazard {
  return { severity: 'blocking', description: over.id, provenance, ...over };
}

export const facility: Facility = {
  id: 'fac-1',
  name: 'Fixture Terminal',
  kind: 'port-terminal',
  location: { lng: -74.1, lat: 40.67 },
  truckEntrances: [],
  requiresTwic: true,
  provenance,
};

export function testContext(opts: {
  config?: DeepPartial<AppConfig>;
  providers?: Partial<Providers>;
  restrictions?: Hazard[];
  facilities?: Facility[];
} = {}): AppContext {
  const config = loadConfig('test', opts.config ?? {}, {});
  return {
    config,
    providers: { ...mockProviders, ...opts.providers },
    cache: new MemoryCache(config.cache.memoryMaxEntries),
    meter: new Meter(config.budgets),
    repo: new MemoryRepository(opts.facilities ?? [facility]),
    data: {
      restrictions: opts.restrictions ?? [],
      restrictionsVersion: 'test-restrictions-1',
      facilities: opts.facilities ?? [facility],
      facilitiesVersion: 'test-facilities-1',
      routingGraphVersion: 'not-built',
    },
    build: { version: '0.1.0', gitSha: 'test' },
    external: { db: false, cache: false },
    now: () => new Date('2026-11-04T12:00:00Z'),
  };
}

export const testApp = (opts: Parameters<typeof testContext>[0] = {}) => {
  const ctx = testContext(opts);
  return { ctx, app: buildApp(ctx) };
};
