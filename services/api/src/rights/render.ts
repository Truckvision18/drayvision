import { RIGHTS_REGISTRY_VERSION, type RightsEntry } from './registry.js';

const yn = (b: boolean): string => (b ? 'yes' : 'no');

/** Render docs/RIGHTS.md. Deterministic: no timestamps beyond the registry version. */
export function renderRightsMarkdown(entries: readonly RightsEntry[]): string {
  const lines: string[] = [
    '# DrayVision data rights',
    '',
    '<!-- GENERATED FILE — do not edit by hand. Source: services/api/src/rights/registry.ts -->',
    '<!-- Regenerate with: npm run rights:doc -->',
    '',
    `Registry version: \`${RIGHTS_REGISTRY_VERSION}\``,
    '',
    'What we may display, cache, proxy and store from each source, and how it must be attributed.',
    'Pilot and prod refuse to serve any source whose status is not `verified`.',
    '',
    '| Source | Status | Display | Cache (max TTL) | Proxy | Store derived | Attribution |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const e of entries) {
    const ttl = !e.mayCache ? 'no' : e.maxCacheTtlSeconds === null ? 'yes (config TTL)' : `yes (≤ ${e.maxCacheTtlSeconds}s)`;
    lines.push(
      `| \`${e.id}\` ${e.name} | **${e.status}** | ${yn(e.mayDisplay)} | ${ttl} | ${yn(e.mayProxy)} | ${yn(e.mayStoreDerived)} | ${e.attribution ?? '—'} |`,
    );
  }
  lines.push('', '## Details', '');
  for (const e of entries) {
    lines.push(`### ${e.name} (\`${e.id}\`)`, '');
    lines.push(`- Provider: ${e.provider}`);
    lines.push(`- Data: ${e.dataTypes.join('; ')}`);
    lines.push(`- Terms: ${e.termsUrl ?? 'not yet located'}`);
    lines.push(`- Verified: ${e.verifiedAt ? `${e.verifiedAt} by ${e.verifiedBy ?? 'unknown'}` : 'not verified'}`);
    lines.push(`- Notes: ${e.notes}`, '');
  }
  return lines.join('\n');
}
