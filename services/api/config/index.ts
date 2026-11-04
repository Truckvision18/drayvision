import { defaults } from './default.js';
import { dev } from './dev.js';
import { pilot } from './pilot.js';
import { prod } from './prod.js';
import { test } from './test.js';
import { configSchema, ENVIRONMENTS, type AppConfig, type DeepPartial, type Environment } from './types.js';

export * from './types.js';

const overrides: Record<Environment, DeepPartial<AppConfig>> = { dev, pilot, prod, test };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge recursively, arrays and scalars replace. `undefined` never overrides. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function resolveEnvironment(raw: string | undefined): Environment {
  const env = raw ?? 'dev';
  if (!(ENVIRONMENTS as readonly string[]).includes(env)) {
    throw new Error(`DRAYVISION_ENV must be one of ${ENVIRONMENTS.join(', ')} (got "${env}")`);
  }
  return env as Environment;
}

/**
 * Load config for an environment. `extra` lets tests or ops inject further overrides.
 * Throws with every schema problem listed if the merged config is invalid.
 */
export function loadConfig(
  env: Environment = resolveEnvironment(process.env.DRAYVISION_ENV),
  extra: DeepPartial<AppConfig> = {},
  processEnv: NodeJS.ProcessEnv = process.env,
): AppConfig {
  let merged = deepMerge({ ...defaults, environment: env }, overrides[env]);
  merged = deepMerge(merged, extra);
  // Narrow, explicit env-var overrides for deployment plumbing only (not tunables).
  if (processEnv.PORT) merged = deepMerge(merged, { server: { port: Number(processEnv.PORT) } });
  if (processEnv.PUBLIC_BASE_URL) merged = deepMerge(merged, { server: { publicBaseUrl: processEnv.PUBLIC_BASE_URL } });
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid DrayVision config for env "${env}":\n${issues}`);
  }
  return parsed.data;
}

/** Returns the names of required env vars that are missing or blank. */
export function missingRequiredEnv(config: AppConfig, processEnv: NodeJS.ProcessEnv = process.env): string[] {
  return config.requiredEnv.filter((k) => !processEnv[k] || processEnv[k]?.trim() === '');
}
