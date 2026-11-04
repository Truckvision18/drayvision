import type { MobileConfig } from '../config';

/**
 * Parked / moving detection gate (Phases 8, 9, 12).
 *
 * Driver-distracting UI (camera stills, preview galleries, text entry, contributions) is only
 * available when the truck is confidently PARKED. Anything uncertain — no fix, stale fix, poor
 * accuracy — is treated as MOVING. Thresholds come from config.safety.
 */
export type MotionState = 'parked' | 'moving' | 'unknown';

export interface MotionSample {
  /** m/s from the location provider; null if unavailable. */
  speedMps: number | null;
  /** Horizontal accuracy in metres. */
  accuracyM: number;
  /** epoch ms */
  timestamp: number;
}

export interface GateState {
  state: MotionState;
  /** Since when samples have consistently pointed to `candidate`. */
  candidate: 'parked' | 'moving' | null;
  candidateSince: number | null;
  lastSampleAt: number | null;
}

export const initialGate: GateState = { state: 'unknown', candidate: null, candidateSince: null, lastSampleAt: null };

export function reduceMotion(g: GateState, s: MotionSample, cfg: MobileConfig['safety']): GateState {
  if (s.speedMps === null || s.accuracyM > cfg.maxAccuracyM || !Number.isFinite(s.speedMps)) {
    // Unusable sample: keep state but don't let it count toward PARKED.
    return { ...g, candidate: g.candidate === 'parked' ? null : g.candidate, candidateSince: g.candidate === 'parked' ? null : g.candidateSince };
  }
  const observed: 'parked' | 'moving' | null =
    s.speedMps >= cfg.movingSpeedMps ? 'moving' : s.speedMps <= cfg.parkedSpeedMps ? 'parked' : null;

  // In the dead band between thresholds, a parked truck is no longer "confidently parked".
  if (observed === null) {
    return { state: g.state === 'parked' ? 'unknown' : g.state, candidate: null, candidateSince: null, lastSampleAt: s.timestamp };
  }

  const since = g.candidate === observed && g.candidateSince !== null ? g.candidateSince : s.timestamp;
  const heldS = (s.timestamp - since) / 1000;
  const needed = observed === 'moving' ? cfg.movingConfirmSeconds : cfg.parkedDwellSeconds;
  // Moving is adopted immediately from parked/unknown once confirmed; parked requires dwell.
  const state: MotionState = heldS >= needed ? observed : observed === 'moving' && g.state === 'parked' ? 'unknown' : g.state;
  return { state, candidate: observed, candidateSince: since, lastSampleAt: s.timestamp };
}

/** Called on a timer: with no recent samples, fall back to UNKNOWN. */
export function checkStale(g: GateState, now: number, cfg: MobileConfig['safety']): GateState {
  if (g.lastSampleAt === null || (now - g.lastSampleAt) / 1000 > cfg.staleAfterSeconds) {
    return { ...g, state: 'unknown', candidate: null, candidateSince: null };
  }
  return g;
}

/** Features that may distract a driver and so require PARKED. */
export type GatedFeature = 'camera-stills' | 'preview-gallery' | 'text-entry' | 'contribute' | 'sponsored-details' | 'settings-edit';

export function isAllowed(_feature: GatedFeature, state: MotionState): boolean {
  return state === 'parked';
}
