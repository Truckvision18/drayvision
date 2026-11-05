import { Platform } from 'react-native';
import { BUILD_ENV } from './buildEnv';
import type { DeepPartial, MobileConfig, MobileEnvironment } from './types';

export type { MobileConfig, MobileEnvironment } from './types';

const defaults: MobileConfig = {
  environment: 'dev',
  api: {
    // Android emulator reaches the host's localhost via 10.0.2.2.
    baseUrl: { ios: 'http://localhost:8080', android: 'http://10.0.2.2:8080' },
    timeoutMs: 15_000,
  },
  map: {
    initialCenter: [-74.15, 40.68], // Port Newark / Elizabeth area
    initialZoom: 10,
    minZoom: 3,
    maxZoom: 19,
  },
  safety: {
    movingSpeedMps: 2.2, // ~5 mph
    parkedSpeedMps: 0.5,
    movingConfirmSeconds: 3,
    parkedDwellSeconds: 10,
    maxAccuracyM: 50,
    staleAfterSeconds: 15,
  },
  navigation: {
    offRouteThresholdM: 40,
    offRouteConfirmSeconds: 4,
    arrivalRadiusM: 50,
    announceAtM: [800, 300, 60],
    maxAccuracyM: 50,
    snapBacktrackM: 30,
    rerouteMinIntervalSeconds: 10,
  },
  defaultTruckProfile: {
    id: 'default-40ft',
    name: "40' container on chassis",
    heightM: 4.11, // 13'6"
    widthM: 2.59, // 8'6"
    lengthM: 21.03, // 69'
    grossWeightKg: 36_287, // 80,000 lb
    axleCount: 5,
    chassis: '40ft',
    hazmat: [],
    twic: true,
  },
  refresh: {
    trafficSeconds: 120,
    camerasSeconds: 60,
    facilitiesSeconds: 3_600,
  },
};

const overrides: Record<MobileEnvironment, DeepPartial<MobileConfig>> = {
  dev: {},
  pilot: {
    api: { baseUrl: { ios: 'https://pilot-api.drayvision.invalid', android: 'https://pilot-api.drayvision.invalid' } },
  },
  prod: {
    api: { baseUrl: { ios: 'https://api.drayvision.invalid', android: 'https://api.drayvision.invalid' } },
  },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function buildConfig(env: MobileEnvironment, extra: DeepPartial<MobileConfig> = {}): MobileConfig {
  return deepMerge(deepMerge({ ...defaults, environment: env }, overrides[env]), extra);
}

export const config: MobileConfig = buildConfig(BUILD_ENV);

export function apiBaseUrl(c: MobileConfig = config): string {
  return Platform.OS === 'android' ? c.api.baseUrl.android : c.api.baseUrl.ios;
}
