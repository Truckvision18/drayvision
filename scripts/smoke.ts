/**
 * Smoke test for a running local/pilot stack. Run by `make setup` and `make smoke`.
 *
 *  1. Fails LOUDLY if any env var required by the current DRAYVISION_ENV is missing/blank.
 *  2. Waits for the API, then checks /health returns data-version info with db + cache up.
 *
 * Unit tests never run this — they need no keys and no Docker.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HealthResponseSchema } from '@drayvision/shared';
import { loadConfig, missingRequiredEnv, resolveEnvironment } from '../services/api/config/index.js';

const root = resolve(import.meta.dirname, '..');

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] && !line.trimStart().startsWith('#')) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return out;
}

function fail(msg: string): never {
  const bar = '!'.repeat(78);
  console.error(`\n${bar}\n  SMOKE TEST FAILED\n\n${msg}\n${bar}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const env = { ...readDotEnv(resolve(root, '.env')), ...process.env };
  const envName = resolveEnvironment(env.DRAYVISION_ENV);
  const config = loadConfig(envName, {}, env);

  const missing = missingRequiredEnv(config, env);
  if (missing.length > 0) {
    fail(
      `  Required environment variables are missing or blank for DRAYVISION_ENV=${envName}:\n\n` +
        missing.map((m) => `    - ${m}`).join('\n') +
        `\n\n  Fill them in ${resolve(root, '.env')} (template: infra/.env.example).`,
    );
  }
  console.log(`✓ required env present for ${envName}: ${config.requiredEnv.join(', ') || '(none)'}`);

  const base = env.SMOKE_API_URL ?? `http://localhost:${env.API_PORT ?? '8080'}`;
  const deadline = Date.now() + Number(env.SMOKE_TIMEOUT_MS ?? 90_000);
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      const parsed = HealthResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        last = `HTTP ${res.status}: /health does not match the shared schema: ${parsed.error.issues[0]?.message}`;
      } else {
        const body = parsed.data;
        if (res.ok && body.dependencies.db === 'up' && body.dependencies.cache === 'up') {
          console.log(`✓ ${base}/health → ${body.status} (env ${body.environment})`);
          console.log(`  data_versions: ${JSON.stringify(body.data_versions)}`);
          console.log(`  dependencies: ${JSON.stringify(body.dependencies)}`);
          if (body.dependencies.routing !== 'up') {
            console.log('  note: routing is not up — expected until tiles are built (services/routing/README.md)');
          }
          return;
        }
        last = `HTTP ${res.status}: ${JSON.stringify(body)}`;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  fail(`  API at ${base} did not become healthy with db + cache up.\n  Last result: ${last}\n  Try: make logs`);
}

void main();
