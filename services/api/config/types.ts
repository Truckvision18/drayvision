import { z } from 'zod';

/**
 * Every tunable number in DrayVision lives here — cache TTLs, rate limits, hazard
 * thresholds, cost budgets, refresh intervals. Code reads `AppConfig`; it never
 * hard-codes these values. Per-environment overrides live in `<env>.ts`.
 *
 * `null` for a cost means "not yet verified" — see docs/COSTS.md. Do not invent figures.
 */
const seconds = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();
const usd = z.number().nonnegative().nullable();

export const ENVIRONMENTS = ['dev', 'pilot', 'prod', 'test'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const SECRET_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'VALHALLA_URL',
  'MAPTILER_KEY',
  'TOLLSMART_API_KEY',
  'TOLLSMART_BASE_URL',
  'GOOGLE_MAPS_API_KEY',
  'NY511_API_KEY',
] as const;
export type SecretEnvVar = (typeof SECRET_ENV_VARS)[number];

const meteredProviders = ['tolls', 'traffic', 'cameras', 'imagery', 'tiles', 'feeds511'] as const;
export type MeteredProvider = (typeof meteredProviders)[number];
const perProvider = <T extends z.ZodTypeAny>(t: T) =>
  z.object(Object.fromEntries(meteredProviders.map((p) => [p, t])) as Record<MeteredProvider, T>);

export const configSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  server: z.object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    bodyLimitBytes: positiveInt,
    requestTimeoutMs: positiveInt,
    /** Public base URL the mobile app reaches the API on — used to rewrite proxied tile URLs. */
    publicBaseUrl: z.string().url(),
  }),
  providers: z.object({
    routing: z.enum(['mock', 'valhalla']),
    tiles: z.enum(['mock', 'maptiler']),
    tolls: z.enum(['mock', 'tollsmart']),
    traffic: z.enum(['mock', 'ny511']),
    cameras: z.enum(['mock', 'ny511']),
    imagery: z.enum(['mock', 'google']),
  }),
  /** Env vars that must be non-empty for this environment; checked at startup and by `make smoke`. */
  requiredEnv: z.array(z.enum(SECRET_ENV_VARS)),
  cache: z.object({
    backend: z.enum(['memory', 'redis']),
    ttlSeconds: perProvider(seconds).extend({ facilities: seconds, route: seconds }),
    memoryMaxEntries: positiveInt,
    keyPrefix: z.string(),
  }),
  rateLimits: z.object({
    windowSeconds: positiveInt,
    /** Requests per device (x-device-id header, falling back to IP) per window, per route group. */
    perDevice: z.object({
      route: positiveInt,
      tolls: positiveInt,
      traffic: positiveInt,
      cameras: positiveInt,
      facilities: positiveInt,
      tiles: positiveInt,
      default: positiveInt,
    }),
  }),
  budgets: z.object({
    /** Monthly spend ceilings in USD. Pilot figure is a planning allowance, NOT a quote — see docs/COSTS.md. */
    monthlyUsd: perProvider(usd).extend({ total: usd }),
    /** Unit cost per metered call in USD; null = unverified, calls are counted but not priced. */
    unitCostUsd: perProvider(usd),
    alertAtFraction: z.number().min(0).max(1),
    /** At this fraction of budget, metered calls are refused and cache-only responses served. */
    hardStopAtFraction: z.number().min(0).max(2),
  }),
  safety: z.object({
    /** Extra vertical clearance demanded above the rig's declared height (metres). */
    clearanceMarginM: z.number().nonnegative(),
    /** Extra weight margin applied to gross weight before comparing to posted limits (kg). */
    weightMarginKg: z.number().nonnegative(),
    /** Distance from route geometry within which a restriction is considered "on route" (metres). */
    hazardMatchRadiusM: z.number().positive(),
    /** If true, routes that fail validation are never returned as navigable. */
    blockOnFail: z.boolean(),
    /** Clearance within this many metres of rig height is a warning, not a pass. */
    clearanceWarnBandM: z.number().nonnegative(),
  }),
  refresh: z.object({
    feeds511Seconds: positiveInt,
    camerasSeconds: positiveInt,
    facilitiesSeconds: positiveInt,
    waitTimesSeconds: positiveInt,
  }),
  routing: z.object({
    timeoutMs: positiveInt,
    defaultValhallaUrl: z.string().url(),
  }),
  rights: z.object({
    /** Allow sources whose rights entry is still "unverified". Must be false in pilot/prod. */
    allowUnverified: z.boolean(),
  }),
  paths: z.object({
    /** Relative to repo root unless absolute. */
    dataDir: z.string(),
    routingDataVersionFile: z.string(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

export type DeepPartial<T> = T extends readonly (infer _U)[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
