import type { Hazard, RouteValidation, TruckProfile } from '@drayvision/shared';
import type { AppConfig } from '../../config/index.js';
import type { RawRoute } from '../providers/types.js';
import { distanceToLine } from './geometry.js';

export interface ValidatedHazards {
  validation: RouteValidation;
  hazards: Hazard[];
}

/**
 * Phase 5 route validation layer. Independent of the routing engine: even if Valhalla's truck
 * costing misses a restriction, every route is re-checked against our verified restriction
 * dataset before it is shown as navigable.
 *
 * Thresholds (margins, match radius, warn band) come from config.safety — never hard-coded.
 */
export function validateRoute(
  route: RawRoute,
  profile: TruckProfile,
  restrictions: readonly Hazard[],
  restrictionsVersion: string,
  safety: AppConfig['safety'],
  now: Date = new Date(),
): ValidatedHazards {
  const violations: RouteValidation['violations'] = [];
  const warnings: RouteValidation['warnings'] = [];
  const onRoute: Hazard[] = [];

  for (const h of restrictions) {
    const { distanceM, alongM } = distanceToLine(h.location, route.geometry);
    if (distanceM > safety.hazardMatchRadiusM) continue;
    const attached: Hazard = { ...h, distanceAlongRouteM: alongM };
    onRoute.push(attached);

    switch (h.kind) {
      case 'low-clearance': {
        if (h.limit === undefined) {
          warnings.push({ hazardId: h.id, reason: 'low clearance with unknown height' });
          break;
        }
        const needed = profile.heightM + safety.clearanceMarginM;
        if (h.limit < needed) {
          violations.push({ hazardId: h.id, reason: `clearance ${h.limit.toFixed(2)}m < required ${needed.toFixed(2)}m` });
        } else if (h.limit < needed + safety.clearanceWarnBandM) {
          warnings.push({ hazardId: h.id, reason: `clearance ${h.limit.toFixed(2)}m within warning band` });
        }
        break;
      }
      case 'weight-limit': {
        const gross = profile.grossWeightKg + safety.weightMarginKg;
        if (h.limit === undefined) warnings.push({ hazardId: h.id, reason: 'weight limit with unknown value' });
        else if (h.limit < gross) violations.push({ hazardId: h.id, reason: `weight limit ${h.limit}kg < ${gross}kg` });
        break;
      }
      case 'length-limit':
        if (h.limit !== undefined && h.limit < profile.lengthM) violations.push({ hazardId: h.id, reason: `length limit ${h.limit}m` });
        break;
      case 'width-limit':
        if (h.limit !== undefined && h.limit < profile.widthM) violations.push({ hazardId: h.id, reason: `width limit ${h.limit}m` });
        break;
      case 'truck-prohibited':
      case 'parkway':
        violations.push({ hazardId: h.id, reason: h.kind });
        break;
      case 'hazmat-prohibited':
      case 'tunnel':
        if (profile.hazmat.length > 0) violations.push({ hazardId: h.id, reason: `${h.kind} with hazmat load` });
        else if (h.kind === 'tunnel') warnings.push({ hazardId: h.id, reason: 'tunnel' });
        break;
      default:
        if (h.severity === 'blocking') violations.push({ hazardId: h.id, reason: h.kind });
        else if (h.severity === 'caution') warnings.push({ hazardId: h.id, reason: h.kind });
    }
  }

  onRoute.sort((a, b) => (a.distanceAlongRouteM ?? 0) - (b.distanceAlongRouteM ?? 0));
  const status: RouteValidation['status'] = violations.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
  return {
    hazards: onRoute,
    validation: { status, violations, warnings, restrictionsVersion, validatedAt: now.toISOString() },
  };
}
