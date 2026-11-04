/**
 * Repo-level scaffold guarantees. These protect the project's ground rules, not features:
 * secrets stay out of git, data stays out of git, every data file has a version + provenance
 * shape, and the mobile app never talks to a metered provider directly.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      const m = /^(MAPTILER_KEY|TOLLSMART_API_KEY|GOOGLE_MAPS_API_KEY|NY511_API_KEY)=(.*)$/.exec(line);
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

describe('data directories', () => {
  it.each(['restrictions', 'facilities'])('data/%s has a versioned manifest and well-formed record files', (dir) => {
    const manifest = JSON.parse(read(`data/${dir}/manifest.json`)) as { datasetVersion?: string };
    expect(manifest.datasetVersion).toBeTruthy();
    for (const f of readdirSync(join(root, 'data', dir)).filter((x) => x.endsWith('.json') && x !== 'manifest.json')) {
      const body = JSON.parse(read(`data/${dir}/${f}`)) as { records?: Array<{ id?: string; provenance?: { source?: string; rightsId?: string } }> };
      expect(Array.isArray(body.records), f).toBe(true);
      for (const r of body.records ?? []) {
        expect(r.id, `${f}: record id`).toBeTruthy();
        expect(r.provenance?.source, `${f}/${r.id}: provenance.source`).toBeTruthy();
        expect(r.provenance?.rightsId, `${f}/${r.id}: provenance.rightsId`).toBeTruthy();
      }
    }
  });

  it('golden route corpus files are well-formed', () => {
    const dir = join(root, 'data/test-routes');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const body = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        routes?: Array<{ id?: string; origin?: unknown; destination?: unknown; profile?: unknown; expect?: { status?: string }; provenance?: unknown }>;
      };
      expect(Array.isArray(body.routes), f).toBe(true);
      for (const r of body.routes ?? []) {
        expect(r.id && r.origin && r.destination && r.profile && r.provenance, `${f}/${r.id}`).toBeTruthy();
        expect(['pass', 'warn', 'fail']).toContain(r.expect?.status);
      }
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
