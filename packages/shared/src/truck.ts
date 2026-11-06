import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LngLatSchema } from './geo.js';

/**
 * Truck profiles. Everything downstream — routing, tolls, safety, ports — keys off these.
 *
 * Rules (enforced by `CompleteTruckProfileSchema` / `profileCompleteness`):
 *  - A profile may be SAVED incomplete (a driver filling it in over time), but no route, toll
 *    or safety call accepts one. Missing dimensions are `null` — never a guessed default.
 *  - Every edit bumps `version`; routes record the exact (id, version) they were computed for,
 *    and anything cached under an older version is invalid.
 *  - All dimensions are SI (metres, kilograms). Convert at the UI edge only.
 */

/** Hazmat classes per 49 CFR 172.101. */
export const HazmatClassSchema = z.union([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => z.literal(n)) as [
  z.ZodLiteral<1>,
  z.ZodLiteral<2>,
  z.ZodLiteral<3>,
  z.ZodLiteral<4>,
  z.ZodLiteral<5>,
  z.ZodLiteral<6>,
  z.ZodLiteral<7>,
  z.ZodLiteral<8>,
  z.ZodLiteral<9>,
]);
export type HazmatClass = z.infer<typeof HazmatClassSchema>;

/**
 * Toll transponder networks a driver may hold (used for toll pricing). We store the network,
 * never the tag's serial number. Interoperability between networks is a toll-pricing concern
 * (Phase 6), not encoded here.
 */
export const TransponderNetworkSchema = z.enum([
  'E_ZPASS',
  'SUNPASS',
  'PEACH_PASS',
  'TXTAG',
  'EZ_TAG',
  'TOLLTAG',
  'FASTRAK',
  'K_TAG',
  'PIKEPASS',
  'NC_QUICK_PASS',
  'GOOD_TO_GO',
  'BESTPASS',
  'OTHER',
]);
export type TransponderNetwork = z.infer<typeof TransponderNetworkSchema>;

export const TransponderSchema = z.object({
  network: TransponderNetworkSchema,
  /** Driver's own nickname, e.g. "fleet tag". */
  label: z.string().max(60).nullable().default(null),
});
export type Transponder = z.infer<typeof TransponderSchema>;

/** Home terminal / default start area. Either a known facility, a point, or both. */
export const HomeTerminalSchema = z
  .object({
    label: z.string().min(1).max(120),
    facility_id: IdSchema.nullable().default(null),
    coords: LngLatSchema.nullable().default(null),
  })
  .refine((h) => h.facility_id !== null || h.coords !== null, { message: 'home_terminal needs a facility_id or coords' });
export type HomeTerminal = z.infer<typeof HomeTerminalSchema>;

/**
 * Plausibility bounds. These are NOT legal limits (those vary by road and permit) — they catch
 * unit mistakes (e.g. 162 entered as inches into a metres field) before they reach routing.
 * They are part of the schema contract, so they live here rather than in per-env config.
 */
export const PROFILE_BOUNDS = {
  height_m: { min: 2.0, max: 5.0 }, // ~6'7" .. 16'5"
  weight_kg: { min: 2_000, max: 72_600 }, // ~4,400 lb .. 160,000 lb (heavy-haul permits)
  length_m: { min: 5.0, max: 35.0 },
  width_m: { min: 2.0, max: 3.7 },
  axle_count: { min: 2, max: 13 },
} as const;

const bounded = (k: 'height_m' | 'weight_kg' | 'length_m' | 'width_m') =>
  z.number().min(PROFILE_BOUNDS[k].min, `${k} below plausible minimum ${PROFILE_BOUNDS[k].min}`).max(PROFILE_BOUNDS[k].max, `${k} above plausible maximum ${PROFILE_BOUNDS[k].max}`);
const axles = z.number().int().min(PROFILE_BOUNDS.axle_count.min).max(PROFILE_BOUNDS.axle_count.max);

/** Hazmat declaration. `carrying: null` = driver hasn't answered → profile incomplete. */
export const HazmatSchema = z
  .object({
    carrying: z.boolean().nullable(),
    classes: z.array(HazmatClassSchema).max(9),
  })
  .refine((h) => h.carrying === true || h.classes.length === 0, { message: 'hazmat classes given but carrying is not true' })
  .refine((h) => h.carrying !== true || h.classes.length > 0, { message: 'carrying hazmat requires at least one class' });
export type Hazmat = z.infer<typeof HazmatSchema>;

/** Fields a driver edits. Dimensions may be null while the profile is a draft. */
const editable = {
  name: z.string().trim().min(1).max(80),
  height_m: bounded('height_m').nullable(),
  /** Gross vehicle weight as loaded. */
  weight_kg: bounded('weight_kg').nullable(),
  length_m: bounded('length_m').nullable(),
  width_m: bounded('width_m').nullable(),
  axle_count: axles.nullable(),
  hazmat: HazmatSchema,
  transponders: z.array(TransponderSchema).max(10),
  home_terminal: HomeTerminalSchema.nullable(),
};

export const TruckProfileSchema = z.object({
  id: IdSchema,
  account_id: IdSchema,
  /** Starts at 1; +1 on every edit. */
  version: z.number().int().min(1),
  ...editable,
  is_default: z.boolean(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type TruckProfile = z.infer<typeof TruckProfileSchema>;

/** POST /profiles body. Only `name` is required; everything else may be filled in later. */
export const TruckProfileCreateSchema = z.object({
  name: editable.name,
  height_m: editable.height_m.default(null),
  weight_kg: editable.weight_kg.default(null),
  length_m: editable.length_m.default(null),
  width_m: editable.width_m.default(null),
  axle_count: editable.axle_count.default(null),
  hazmat: editable.hazmat.default({ carrying: null, classes: [] }),
  transponders: editable.transponders.default([]),
  home_terminal: editable.home_terminal.default(null),
  is_default: z.boolean().optional(),
});
export type TruckProfileCreate = z.input<typeof TruckProfileCreateSchema>;

/**
 * PATCH /profiles/:id body. `expected_version` is the version the client edited from — a
 * mismatch means another device edited first (409), so stale edits never overwrite silently.
 */
export const TruckProfileUpdateSchema = z
  .object({
    expected_version: z.number().int().min(1),
    name: editable.name.optional(),
    height_m: editable.height_m.optional(),
    weight_kg: editable.weight_kg.optional(),
    length_m: editable.length_m.optional(),
    width_m: editable.width_m.optional(),
    axle_count: editable.axle_count.optional(),
    hazmat: editable.hazmat.optional(),
    transponders: editable.transponders.optional(),
    home_terminal: editable.home_terminal.optional(),
  })
  .strict();
export type TruckProfileUpdate = z.input<typeof TruckProfileUpdateSchema>;

/** The fields that must be present before any route / toll / safety call. */
export const REQUIRED_PROFILE_FIELDS = ['height_m', 'weight_kg', 'length_m', 'width_m', 'axle_count', 'hazmat'] as const;
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

/** A profile that may be used for routing: every required dimension present, hazmat answered. */
export const CompleteTruckProfileSchema = TruckProfileSchema.extend({
  height_m: bounded('height_m'),
  weight_kg: bounded('weight_kg'),
  length_m: bounded('length_m'),
  width_m: bounded('width_m'),
  axle_count: axles,
  hazmat: HazmatSchema.refine((h) => h.carrying !== null, { message: 'hazmat must be answered' }),
});
export type CompleteTruckProfile = z.infer<typeof CompleteTruckProfileSchema> & { hazmat: { carrying: boolean } };

export interface ProfileCompleteness {
  complete: boolean;
  missing_fields: RequiredProfileField[];
  /** Driver-facing message; null when complete. */
  message: string | null;
}

const FIELD_LABELS: Record<RequiredProfileField, string> = {
  height_m: 'height',
  weight_kg: 'weight',
  length_m: 'length',
  width_m: 'width',
  axle_count: 'axle count',
  hazmat: 'hazmat (yes / no)',
};

export function profileCompleteness(p: Pick<TruckProfile, RequiredProfileField>): ProfileCompleteness {
  const missing = REQUIRED_PROFILE_FIELDS.filter((f) => (f === 'hazmat' ? p.hazmat.carrying === null : p[f] === null));
  if (missing.length === 0) return { complete: true, missing_fields: [], message: null };
  const list = missing.map((f) => FIELD_LABELS[f]);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  return {
    complete: false,
    missing_fields: missing,
    message: `Complete your truck profile: add ${joined} before DrayVision can plan a route.`,
  };
}

export function isCompleteProfile(p: TruckProfile): p is CompleteTruckProfile {
  return profileCompleteness(p).complete;
}

/** The exact profile revision a route / toll / safety result was computed for. */
export const ProfileRefSchema = z.object({
  truck_profile_id: IdSchema,
  truck_profile_version: z.number().int().min(1),
});
export type ProfileRef = z.infer<typeof ProfileRefSchema>;
