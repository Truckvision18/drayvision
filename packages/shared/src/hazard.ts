import { z } from 'zod';
import { IdSchema, LngLatSchema, SourceSchema } from './geo.js';
import { HazmatClassSchema } from './truck.js';

/**
 * A hazard to a truck. Used both for records in the verified restriction dataset
 * (data/restrictions) and for hazards attached to a route by the safety layer.
 *
 * `value` units depend on `type`:
 *   LOW_CLEARANCE      → metres of vertical clearance (required)
 *   WEIGHT_LIMIT       → kilograms (required)
 *   TRUCK_RESTRICTION  → depends on `restriction`: MAX_LENGTH / MAX_WIDTH metres, MAX_AXLES count,
 *                        NO_TRUCKS / PARKWAY null
 *   HAZMAT_RESTRICTION → null (`hazmat_classes` lists the banned classes; empty = all)
 *   UNKNOWN_CLEARANCE  → null (a structure whose clearance we don't know — never "assume fine")
 *
 * `resolved` means "no action needed":
 *   - on a dataset record: the hazard no longer exists (e.g. bridge replaced) and is ignored;
 *   - on a route: evaluated and does not affect this truck (kept for transparency).
 * An unresolved hazard on a route either blocks it or needs the driver's attention.
 */
export const HazardTypeSchema = z.enum(['LOW_CLEARANCE', 'WEIGHT_LIMIT', 'TRUCK_RESTRICTION', 'HAZMAT_RESTRICTION', 'UNKNOWN_CLEARANCE']);
export type HazardType = z.infer<typeof HazardTypeSchema>;

export const TruckRestrictionKindSchema = z.enum(['NO_TRUCKS', 'PARKWAY', 'MAX_LENGTH', 'MAX_WIDTH', 'MAX_AXLES']);
export type TruckRestrictionKind = z.infer<typeof TruckRestrictionKindSchema>;

export const HazardSchema = z
  .object({
    id: IdSchema,
    type: HazardTypeSchema,
    location: LngLatSchema,
    value: z.number().positive().nullable(),
    restriction: TruckRestrictionKindSchema.nullable().default(null),
    hazmat_classes: z.array(HazmatClassSchema).default([]),
    description: z.string().min(1),
    source: SourceSchema,
    /** 0..1 — how sure we are the record is accurate (verified official data ≈ 1). */
    confidence: z.number().min(0).max(1),
    resolved: z.boolean(),
    /** Set when the hazard is attached to a route. */
    distance_along_route_m: z.number().nonnegative().optional(),
  })
  .superRefine((h, ctx) => {
    const need = (ok: boolean, message: string) => !ok && ctx.addIssue({ code: 'custom', message });
    switch (h.type) {
      case 'LOW_CLEARANCE':
        need(h.value !== null, 'LOW_CLEARANCE needs value (metres)');
        break;
      case 'WEIGHT_LIMIT':
        need(h.value !== null, 'WEIGHT_LIMIT needs value (kg)');
        break;
      case 'UNKNOWN_CLEARANCE':
        need(h.value === null, 'UNKNOWN_CLEARANCE must not carry a value');
        break;
      case 'TRUCK_RESTRICTION':
        need(h.restriction !== null, 'TRUCK_RESTRICTION needs restriction');
        if (h.restriction === 'MAX_LENGTH' || h.restriction === 'MAX_WIDTH' || h.restriction === 'MAX_AXLES') {
          need(h.value !== null, `${h.restriction} needs value`);
        }
        break;
      case 'HAZMAT_RESTRICTION':
        break;
    }
    if (h.type !== 'TRUCK_RESTRICTION') need(h.restriction === null, 'restriction only applies to TRUCK_RESTRICTION');
  });
export type Hazard = z.output<typeof HazardSchema>;
export type HazardInput = z.input<typeof HazardSchema>;
