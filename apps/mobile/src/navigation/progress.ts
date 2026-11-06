import { cumulativeDistances, projectOntoLine, type LngLat, type Maneuver, type Route } from '@drayvision/shared';
import type { MobileConfig } from '../config';

/**
 * Turn-by-turn progress tracking (Phase 4). Pure functions over a route + GPS fixes, so the
 * logic is fully testable without a device. Thresholds come from config.navigation.
 */

export interface Fix {
  location: LngLat;
  accuracyM: number;
  /** epoch ms */
  timestamp: number;
}

/** Precomputed lookups for one route. Build once per route with `indexRoute`. */
export interface RouteIndex {
  route: Route;
  maneuvers: Maneuver[];
  cumulative: number[];
  /** Distance along the route (m) where each maneuver happens. */
  maneuverAlongM: number[];
  totalM: number;
}

export function indexRoute(route: Route): RouteIndex {
  const cumulative = cumulativeDistances(route.geometry);
  const maneuvers = route.maneuvers;
  const last = cumulative.at(-1) ?? 0;
  const maneuverAlongM = maneuvers.map((m) => cumulative[Math.min(m.begin_shape_index, cumulative.length - 1)] ?? 0);
  return { route, maneuvers, cumulative, maneuverAlongM, totalM: last };
}

export interface Progress {
  snapped: LngLat;
  /** Distance from the fix to the route line. */
  crossTrackM: number;
  /** Distance travelled along the route. */
  alongM: number;
  /** Index (into the flattened maneuver list) of the NEXT maneuver to perform. */
  nextManeuverIndex: number;
  distanceToNextManeuverM: number;
  remainingM: number;
  /** Remaining time, scaled from the engine's ETA by remaining distance. */
  remainingS: number;
}

export function computeProgress(idx: RouteIndex, fix: Fix, lastAlongM: number, cfg: MobileConfig['navigation']): Progress {
  const proj = projectOntoLine(fix.location, idx.route.geometry, {
    cumulative: idx.cumulative,
    fromAlongM: Math.max(0, lastAlongM - cfg.snapBacktrackM),
  });
  const alongM = Math.min(proj.alongM, idx.totalM);
  // Next maneuver = first one strictly ahead of us (the depart maneuver at 0 m is behind once moving).
  let next = idx.maneuvers.length - 1;
  for (let i = 0; i < idx.maneuvers.length; i++) {
    if (idx.maneuverAlongM[i]! > alongM + 1) {
      next = i;
      break;
    }
  }
  const remainingM = Math.max(0, idx.totalM - alongM);
  const remainingS = idx.totalM > 0 ? (idx.route.duration_s * remainingM) / idx.totalM : 0;
  return {
    snapped: proj.point,
    crossTrackM: proj.distanceM,
    alongM,
    nextManeuverIndex: next,
    distanceToNextManeuverM: Math.max(0, idx.maneuverAlongM[next]! - alongM),
    remainingM,
    remainingS,
  };
}

/** Tracker state carried between fixes. */
export interface TrackerState {
  lastAlongM: number;
  offRouteSince: number | null;
  /** `${maneuverIndex}@${thresholdM}` keys already announced. */
  announced: string[];
  arrived: boolean;
}

export const initialTracker: TrackerState = { lastAlongM: 0, offRouteSince: null, announced: [], arrived: false };

export type TrackerEvent =
  | { type: 'progress'; progress: Progress }
  | { type: 'announce'; maneuverIndex: number; text: string; atM: number }
  | { type: 'off-route' }
  | { type: 'arrived' };

/**
 * Feed one GPS fix. Returns the new tracker state and the events it produced, in order.
 * Inaccurate fixes produce no events — we never reroute or announce from a bad fix.
 */
export function trackFix(
  idx: RouteIndex,
  state: TrackerState,
  fix: Fix,
  cfg: MobileConfig['navigation'],
): { state: TrackerState; events: TrackerEvent[] } {
  if (state.arrived || fix.accuracyM > cfg.maxAccuracyM) return { state, events: [] };

  const progress = computeProgress(idx, fix, state.lastAlongM, cfg);
  const events: TrackerEvent[] = [];

  // Off-route: must persist for offRouteConfirmSeconds.
  if (progress.crossTrackM > cfg.offRouteThresholdM) {
    const since = state.offRouteSince ?? fix.timestamp;
    if ((fix.timestamp - since) / 1000 >= cfg.offRouteConfirmSeconds) {
      return { state: { ...state, offRouteSince: since }, events: [{ type: 'off-route' }] };
    }
    // While uncertain, hold position: don't advance progress from an off-line fix.
    return { state: { ...state, offRouteSince: since }, events: [] };
  }

  events.push({ type: 'progress', progress });
  const next: TrackerState = { ...state, lastAlongM: Math.max(state.lastAlongM, progress.alongM), offRouteSince: null };

  if (progress.remainingM <= cfg.arrivalRadiusM) {
    events.push({ type: 'arrived' });
    return { state: { ...next, arrived: true }, events };
  }

  // Announce each threshold once per maneuver, only the closest threshold we've crossed.
  const m = idx.maneuvers[progress.nextManeuverIndex];
  const crossed = [...cfg.announceAtM].sort((a, b) => a - b).find((t) => progress.distanceToNextManeuverM <= t);
  if (m && crossed !== undefined) {
    const key = `${progress.nextManeuverIndex}@${crossed}`;
    if (!next.announced.includes(key)) {
      events.push({ type: 'announce', maneuverIndex: progress.nextManeuverIndex, text: m.verbal_instruction ?? m.instruction, atM: crossed });
      next.announced = [...next.announced, key];
    }
  }
  return { state: next, events };
}
