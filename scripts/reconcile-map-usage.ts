/**
 * Test-day reconciliation: does our tile-proxy count match the provider's dashboard?
 *
 *   npx tsx scripts/reconcile-map-usage.ts --day 2026-11-07 --dashboard 48213 [--api http://localhost:8080]
 *
 * --dashboard is the request count MapTiler's Analytics page shows for that day (for the API
 * key the proxy uses). We compare it with OUR billable_requests for source=maptiler — the same
 * weighting MapTiler applies (vector tile 1, 512px raster 4, style/TileJSON/fonts 0) — and fail
 * if the difference exceeds config.tiles.reconcileTolerance. Outside dev, set OPS_TOKEN.
 */
import { MapUsageResponseSchema } from '@drayvision/shared';
import { loadConfig, resolveEnvironment } from '../services/api/config/index.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function reconcile(ours: number, dashboard: number, tolerance: number): { ok: boolean; diff: number; relative: number } {
  const diff = ours - dashboard;
  const relative = dashboard === 0 ? (ours === 0 ? 0 : 1) : Math.abs(diff) / dashboard;
  return { ok: relative <= tolerance, diff, relative };
}

async function main(): Promise<void> {
  const day = arg('day');
  const dashboard = Number(arg('dashboard'));
  if (!day || !Number.isFinite(dashboard)) {
    console.error('usage: reconcile-map-usage.ts --day YYYY-MM-DD --dashboard <requests> [--api URL]');
    process.exit(2);
  }
  const config = loadConfig(resolveEnvironment(process.env.DRAYVISION_ENV), {}, process.env);
  const api = arg('api') ?? `http://localhost:${process.env.API_PORT ?? '8080'}`;
  const res = await fetch(`${api}/usage/maps?day=${day}`, { headers: process.env.OPS_TOKEN ? { 'x-ops-token': process.env.OPS_TOKEN } : {} });
  if (!res.ok) throw new Error(`GET /usage/maps → ${res.status}: ${await res.text()}`);
  const usage = MapUsageResponseSchema.parse(await res.json());
  const mt = usage.days.find((d) => d.source === 'maptiler');
  const ours = mt?.billable_requests ?? 0;
  const r = reconcile(ours, dashboard, config.tiles.reconcileTolerance);
  console.log(`day ${day} (UTC)`);
  console.log(`  ours (billable, maptiler): ${ours}   [upstream requests ${mt?.upstream_requests ?? 0}, by kind ${JSON.stringify(mt?.by_kind ?? {})}]`);
  console.log(`  MapTiler dashboard:        ${dashboard}`);
  console.log(`  difference:                ${r.diff} (${(r.relative * 100).toFixed(2)} %, tolerance ${(config.tiles.reconcileTolerance * 100).toFixed(1)} %)`);
  console.log(`  devices active: ${new Set((usage.per_device ?? []).map((d) => d.device_id)).size}, sessions: ${mt?.sessions ?? 0}`);
  console.log(r.ok ? '✓ within tolerance' : '✗ OUTSIDE tolerance — check day boundary (UTC), other apps on the same key, and unlisted kinds (sprites)');
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith('reconcile-map-usage.ts')) void main();
