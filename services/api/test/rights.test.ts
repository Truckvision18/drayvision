import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromRoot } from '../src/paths.js';
import { decideUse, rightsRegistry } from '../src/rights/registry.js';
import { renderRightsMarkdown } from '../src/rights/render.js';

describe('rights registry', () => {
  it('has unique ids and verified entries carry evidence', () => {
    const ids = rightsRegistry.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of rightsRegistry.filter((x) => x.status === 'verified')) {
      expect(r.verifiedAt, r.id).toBeTruthy();
      expect(r.verifiedBy, r.id).toBeTruthy();
      expect(r.termsUrl, r.id).toBeTruthy();
    }
  });

  it('caps cache TTL by the rights ceiling', () => {
    expect(decideUse('google-imagery', 3600, true).cacheTtlSeconds).toBe(0);
    expect(decideUse('osm', 3600, true).cacheTtlSeconds).toBe(3600);
    expect(decideUse('unknown', 3600, true).allowed).toBe(false);
  });

  it('docs/RIGHTS.md is up to date with the registry (run `npm run rights:doc`)', () => {
    expect(readFileSync(fromRoot('docs/RIGHTS.md'), 'utf8')).toBe(renderRightsMarkdown(rightsRegistry));
  });
});
