/**
 * Repo-level scaffold guarantees. These protect the project's ground rules, not features:
 * secrets stay out of git, data stays out of git, every data file has a version + provenance
 * shape, and the mobile app never talks to a metered provider directly.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompleteTruckProfileSchema, FacilitySchema, HazardSchema, LngLatSchema, SafetyStatusSchema } from '@drayvision/shared';
import { z } from 'zod';
import { SECRET_ENV_VARS } from '../services/api/config/index.js';

const root = resolve(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('repository hygiene', () => {
  it('.gitignore excludes secrets and raw/OSM data', () => {
    const gi = read('.gitignore').split('\n').map((l) => l.trim());
    for (const required of ['.env', 'extracts/', '*.osm.pbf', 'data/raw/']) expect(gi).toContain(required);
  });

  it('.env.example declares every secret the API knows about', () => {
    const example = read('infra/.env.example');
    for (const k of SECRET_ENV_VARS) expect(example, k).toMatch(new RegExp(`^${k}=`, 'm'));
  });

  it('.env.example contains no real-looking secret values', () => {
    for (const line of read('infra/.env.example').split('\n')) {
      const m = /^(MAPTILER_KEY|MAPTILER_CLIENT_KEY|OPS_TOKEN|TOLLSMART_API_KEY|GOOGLE_MAPS_API_KEY|NY511_API_KEY)=(.*)$/.exec(line);
      if (m) expect(m[2], m[1]).toBe('');
    }
  });

  it('required docs exist', () => {
    for (const p of ['README.md', 'docs/RIGHTS.md', 'docs/COSTS.md']) expect(existsSync(join(root, p)), p).toBe(true);
  });

  it('COSTS.md carries the component-comparison caveat and pilot planning range', () => {
    const costs = read('docs/COSTS.md');
    expect(costs).toMatch(/different components/i);
    expect(costs).toMatch(/\$500.{1,3}\$2,500/);
    expect(costs).toMatch(/Phase 13/);
  });
});

describe('data directories validate against the shared schemas', () => {
  const records = (dir: string) =>
    readdirSync(join(root, 'data', dir))
      .filter((x) => x.endsWith('.json') && x !== 'manifest.json')
      .map((f) => [f, JSON.parse(read(`data/${dir}/${f}`))] as const);

  it.each(['restrictions', 'facilities'])('data/%s has a versioned manifest', (dir) => {
    expect((JSON.parse(read(`data/${dir}/manifest.json`)) as { datasetVersion?: string }).datasetVersion).toBeTruthy();
  });

  it('every restriction record is a valid Hazard', () => {
    for (const [f, body] of records('restrictions')) {
      const r = z.object({ records: z.array(HazardSchema) }).safeParse(body);
      expect(r.success, `${f}: ${r.success ? '' : JSON.stringify(r.error.issues[0])}`).toBe(true);
    }
  });

  it('every facility record is a valid Facility', () => {
    for (const [f, body] of records('facilities')) {
      const r = z.object({ records: z.array(FacilitySchema) }).safeParse(body);
      expect(r.success, `${f}: ${r.success ? '' : JSON.stringify(r.error.issues[0])}`).toBe(true);
    }
  });

  it('golden routes use complete truck profiles and shared types', () => {
    // A golden case must pin a fully specified rig — a guessed profile would make it meaningless.
    const Golden = z.object({
      routes: z.array(
        z.object({
          id: z.string().min(1),
          description: z.string().min(1),
          origin: LngLatSchema,
          destination: LngLatSchema,
          profile: CompleteTruckProfileSchema.pick({ height_m: true, weight_kg: true, length_m: true, width_m: true, axle_count: true, hazmat: true }),
          expect: z.object({ status: SafetyStatusSchema, must_avoid_hazard_ids: z.array(z.string()).default([]) }),
          provenance: z.object({ added_by: z.string().min(1), added_at: z.string().min(1), reason: z.string().min(1) }),
        }),
      ),
    });
    for (const f of readdirSync(join(root, 'data/test-routes')).filter((x) => x.endsWith('.json'))) {
      const r = Golden.safeParse(JSON.parse(read(`data/test-routes/${f}`)));
      expect(r.success, `${f}: ${r.success ? '' : JSON.stringify(r.error.issues[0])}`).toBe(true);
    }
  });
});

describe('mobile never calls a metered provider directly', () => {
  const forbidden = [/api\.maptiler\.com/i, /maps\.googleapis\.com/i, /tollsmart/i, /511ny\.org/i, /MAPTILER_KEY|GOOGLE_MAPS_API_KEY|NY511_API_KEY|TOLLSMART_API_KEY/];
  const files = walk(join(root, 'apps/mobile/src')).filter((f) => /\.(ts|tsx|js|json)$/.test(f));

  it('has source files to check', () => expect(files.length).toBeGreaterThan(0));

  it.each(forbidden.map((r) => [r.source, r] as const))('no reference to %s', (_label, re) => {
    const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});

describe('one mapping SDK for the whole app', () => {
  const mobilePkg = JSON.parse(read('apps/mobile/package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = Object.keys({ ...mobilePkg.dependencies, ...mobilePkg.devDependencies });

  it('MapLibre React Native is the only map SDK dependency', () => {
    const mapSdks = deps.filter((d) => /map(s|box|libre|kit)|google-?maps|leaflet|here-|tomtom|mapview/i.test(d) && d !== '@maplibre/maplibre-react-native');
    expect(mapSdks).toEqual([]);
    expect(deps).toContain('@maplibre/maplibre-react-native');
  });

  it('only src/map/ (plus the GPS feed) talks to the map SDK — every map goes through MapView', () => {
    const files = walk(join(root, 'apps/mobile/src')).filter((f) => /\.(ts|tsx)$/.test(f));
    const importers = files
      .filter((f) => /from '@maplibre\/maplibre-react-native'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(join(root, 'apps/mobile/src').length + 1));
    const allowed = (f: string) => f.startsWith('map/') || f === 'location/LocationContext.tsx';
    expect(importers.filter((f) => !allowed(f))).toEqual([]);
    // ...and the GPS feed only uses location services, never a map component.
    const loc = read('apps/mobile/src/location/LocationContext.tsx');
    expect(loc).not.toMatch(/\b(Map|Camera|Layer|GeoJSONSource|Marker)\b.*from '@maplibre/);
  });
});
