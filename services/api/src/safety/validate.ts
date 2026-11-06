import { cumulativeDistances, projectOntoLine, type CompleteTruckProfile, type Hazard, type LineCoordinates, type SafetyResult } from '@drayvision/shared';
import type { AppConfig } from '../../config/index.js';

type Verdict = { outcome: 'clear' } | { outcome: 'warn'; reason: string } | { outcome: 'fail'; reason: string };

/**
 * Judge one hazard for one truck. Fail-safe by construction:
 *  - missing or unknown data never clears a hazard (warn at least);
 *  - a low-confidence record can FAIL a route but can never CLEAR it.
 * All margins / thresholds come from config.safety.
 */
export function judgeHazard(h: Hazard, p: CompleteTruckProfile, s: AppConfig['safety']): Verdict {
  const lowConfidence = h.confidence < s.minConfidenceToClear;
  const clearOrDoubt = (what: string): Verdict =>
    lowConfidence ? { outcome: 'warn', reason: `${what} (record confidence ${h.confidence} below ${s.minConfidenceToClear})` } : { outcome: 'clear' };

  switch (h.type) {
    case 'LOW_CLEARANCE': {
      const clearance = h.value!;
      const needed = p.height_m + s.clearanceMarginM;
      if (clearance < needed) return { outcome: 'fail', reason: `clearance ${clearance.toFixed(2)} m < required ${needed.toFixed(2)} m` };
      if (clearance < needed + s.clearanceWarnBandM) return { outcome: 'warn', reason: `clearance ${clearance.toFixed(2)} m is within the warning band` };
      return clearOrDoubt(`clearance ${clearance.toFixed(2)} m`);
    }
    case 'UNKNOWN_CLEARANCE':
      return { outcome: 'warn', reason: 'structure with unknown clearance' };
    case 'WEIGHT_LIMIT': {
      const gross = p.weight_kg + s.weightMarginKg;
      if (h.value! < gross) return { outcome: 'fail', reason: `weight limit ${h.value} kg < ${gross} kg` };
      return clearOrDoubt(`weight limit ${h.value} kg`);
    }
    case 'TRUCK_RESTRICTION':
      switch (h.restriction) {
        case 'NO_TRUCKS':
        case 'PARKWAY':
          return { outcome: 'fail', reason: h.restriction === 'PARKWAY' ? 'parkway (no commercial vehicles)' : 'trucks prohibited' };
        case 'MAX_LENGTH':
          return h.value! < p.length_m ? { outcome: 'fail', reason: `length limit ${h.value} m` } : clearOrDoubt(`length limit ${h.value} m`);
        case 'MAX_WIDTH':
          return h.value! < p.width_m ? { outcome: 'fail', reason: `width limit ${h.value} m` } : clearOrDoubt(`width limit ${h.value} m`);
        case 'MAX_AXLES':
          return h.value! < p.axle_count ? { outcome: 'fail', reason: `axle limit ${h.value}` } : clearOrDoubt(`axle limit ${h.value}`);
        default:
          return { outcome: 'fail', reason: 'truck restriction of unknown kind' };
      }
    case 'HAZMAT_RESTRICTION': {
      if (!p.hazmat.carrying) return { outcome: 'clear' };
      const banned = h.hazmat_classes.length === 0 || p.hazmat.classes.some((c) => h.hazmat_classes.includes(c));
      return banned ? { outcome: 'fail', reason: `hazmat restricted (${h.hazmat_classes.length ? `classes ${h.hazmat_classes.join(', ')}` : 'all classes'})` } : { outcome: 'clear' };
    }
  }
}

/**
 * Phase 5 route validation layer. Independent of the routing engine: every route is re-checked
 * against our verified restriction dataset before it is offered as navigable.
 */
export function validateRoute(
  geometry: LineCoordinates,
  profile: CompleteTruckProfile,
  restrictions: readonly Hazard[],
  safety: AppConfig['safety'],
  now: Date = new Date(),
): SafetyResult {
  const cumulative = cumulativeDistances(geometry);
  const hazards: Hazard[] = [];
  const violations: SafetyResult['violations'] = [];
  const warnings: SafetyResult['warnings'] = [];

  for (const h of restrictions) {
    if (h.resolved) continue; // retired record (e.g. bridge replaced)
    const { distanceM, alongM } = projectOntoLine(h.location, geometry, { cumulative });
    if (distanceM > safety.hazardMatchRadiusM) continue;
    const v = judgeHazard(h, profile, safety);
    hazards.push({ ...h, distance_along_route_m: alongM, resolved: v.outcome === 'clear' });
    if (v.outcome === 'fail') violations.push({ hazard_id: h.id, reason: v.reason });
    if (v.outcome === 'warn') warnings.push({ hazard_id: h.id, reason: v.reason });
  }

  hazards.sort((a, b) => (a.distance_along_route_m ?? 0) - (b.distance_along_route_m ?? 0));
  return {
    status: violations.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS',
    hazards,
    violations,
    warnings,
    validated_at: now.toISOString(),
  };
}
