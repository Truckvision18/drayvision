import type { TruckProfile } from '@drayvision/shared';

export type MobileEnvironment = 'dev' | 'pilot' | 'prod';

/**
 * Every tunable number the app uses. Values live in config, never inline in components.
 * Per-environment overrides: src/config/index.ts.
 */
export interface MobileConfig {
  environment: MobileEnvironment;
  api: {
    /** Our API only. The app never calls a metered provider directly. */
    baseUrl: { ios: string; android: string };
    timeoutMs: number;
  };
  map: {
    /** Initial camera before we have a GPS fix: [lng, lat]. */
    initialCenter: [number, number];
    initialZoom: number;
    minZoom: number;
    maxZoom: number;
  };
  /** Parked / moving detection gate (Phases 8, 9, 12). */
  safety: {
    /** Above this speed (m/s) a sample counts as moving. */
    movingSpeedMps: number;
    /** Below this speed (m/s) a sample counts as stationary. */
    parkedSpeedMps: number;
    /** Continuous moving time needed to switch to MOVING. */
    movingConfirmSeconds: number;
    /** Continuous stationary time needed to switch to PARKED. */
    parkedDwellSeconds: number;
    /** GPS samples worse than this horizontal accuracy (m) are ignored. */
    maxAccuracyM: number;
    /** With no fresh sample for this long, fall back to UNKNOWN (treated as moving). */
    staleAfterSeconds: number;
  };
  /** Turn-by-turn (Phases 4–5). */
  navigation: {
    /** Cross-track distance (m) beyond which a fix counts as off-route. */
    offRouteThresholdM: number;
    /** Off-route must persist this long before we reroute (filters GPS jitter). */
    offRouteConfirmSeconds: number;
    /** Remaining distance (m) at which the trip counts as arrived. */
    arrivalRadiusM: number;
    /** Distances (m) before a maneuver at which to announce it, largest first. */
    announceAtM: number[];
    /** Fixes with worse horizontal accuracy (m) are ignored for progress / off-route. */
    maxAccuracyM: number;
    /** How far (m) behind the last snapped position a fix may snap (GPS jitter, not U-turns). */
    snapBacktrackM: number;
    /** Minimum time between reroute requests. */
    rerouteMinIntervalSeconds: number;
  };
  /** Rig used until the driver sets their own in Settings. SI units. */
  defaultTruckProfile: TruckProfile;
  refresh: {
    trafficSeconds: number;
    camerasSeconds: number;
    facilitiesSeconds: number;
  };
}

export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
