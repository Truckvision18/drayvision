import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LngLatSchema } from './geo.js';

/** How a truck entrance's location is known. */
export const EntranceSourceSchema = z.enum(['OFFICIAL', 'DRIVER_VERIFIED', 'UNVERIFIED']);
export type EntranceSource = z.infer<typeof EntranceSourceSchema>;

/**
 * Where trucks actually enter — often not the street address. Routing to a facility goes to
 * its primary truck entrance.
 */
export const TruckEntranceSchema = z
  .object({
    id: IdSchema,
    coords: LngLatSchema,
    street: z.string().min(1),
    is_primary: z.boolean(),
    verified_by: z.string().min(1).nullable(),
    verified_at: IsoDateTimeSchema.nullable(),
    source: EntranceSourceSchema,
    /** Free text: hours, gate number, "enter from Corbin St only", ... */
    notes: z.string().nullable().default(null),
  })
  .refine((e) => e.source === 'UNVERIFIED' || (e.verified_by !== null && e.verified_at !== null), {
    message: 'OFFICIAL / DRIVER_VERIFIED entrances need verified_by and verified_at',
  });
export type TruckEntrance = z.output<typeof TruckEntranceSchema>;

export const PlaceDetailSchema = z.object({
  coords: LngLatSchema.nullable(),
  description: z.string().min(1),
});
export type PlaceDetail = z.infer<typeof PlaceDetailSchema>;

export const DockSchema = z.object({
  id: IdSchema,
  label: z.string().min(1),
  coords: LngLatSchema.nullable(),
  notes: z.string().nullable().default(null),
});
export type Dock = z.output<typeof DockSchema>;

export const FacilityNoteSchema = z.object({
  text: z.string().min(1),
  source: EntranceSourceSchema,
  created_at: IsoDateTimeSchema,
});
export type FacilityNote = z.infer<typeof FacilityNoteSchema>;

export const VerificationStateSchema = z.enum(['UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED']);
export type VerificationState = z.infer<typeof VerificationStateSchema>;

export const FacilityKindSchema = z.enum(['PORT_TERMINAL', 'RAIL_RAMP', 'WAREHOUSE', 'CONTAINER_YARD', 'TRUCK_PARKING', 'SCALE', 'FUEL']);
export type FacilityKind = z.infer<typeof FacilityKindSchema>;

export const FacilitySchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    kind: FacilityKindSchema,
    street_address: z.string().min(1),
    truck_entrances: z.array(TruckEntranceSchema),
    receiving_office: PlaceDetailSchema.nullable().default(null),
    staging_area: PlaceDetailSchema.nullable().default(null),
    docks: z.array(DockSchema).default([]),
    notes: z.array(FacilityNoteSchema).default([]),
    verification_state: VerificationStateSchema,
    requires_twic: z.boolean().default(false),
  })
  .refine((f) => f.truck_entrances.filter((e) => e.is_primary).length <= 1, { message: 'at most one primary truck entrance' })
  .refine((f) => f.truck_entrances.length === 0 || f.truck_entrances.some((e) => e.is_primary), {
    message: 'a facility with truck entrances must mark one as primary',
  });
export type Facility = z.output<typeof FacilitySchema>;

export function primaryEntrance(f: Facility): TruckEntrance | null {
  return f.truck_entrances.find((e) => e.is_primary) ?? null;
}

export const WaitTimeObservationSchema = z.object({
  facility_id: IdSchema,
  observed_at: IsoDateTimeSchema,
  wait_minutes: z.number().int().nonnegative(),
  source: z.enum(['DRIVER_REPORT', 'GEOFENCE_DWELL', 'TERMINAL_FEED']),
});
export type WaitTimeObservation = z.infer<typeof WaitTimeObservationSchema>;

/** Sponsored content is ALWAYS labelled "Sponsored" in the UI and never styled as a safety marker. */
export const SponsoredListingSchema = z.object({
  id: IdSchema,
  facility_id: IdSchema.nullable(),
  title: z.string().min(1),
  location: LngLatSchema,
  label: z.literal('Sponsored'),
  active_from: IsoDateTimeSchema,
  active_to: IsoDateTimeSchema,
});
export type SponsoredListing = z.infer<typeof SponsoredListingSchema>;

export const FacilitiesResponseSchema = z.object({ facilities: z.array(FacilitySchema) });
export const PortsResponseSchema = z.object({
  ports: z.array(FacilitySchema.and(z.object({ latest_wait: WaitTimeObservationSchema.nullable() }))),
});
export const SponsoredResponseSchema = z.object({ listings: z.array(SponsoredListingSchema) });
