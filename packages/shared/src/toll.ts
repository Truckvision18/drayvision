import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LineCoordinatesSchema } from './geo.js';
import { ProfileRefSchema, TransponderNetworkSchema } from './truck.js';

/** POST /tolls. Requires a COMPLETE truck profile (axles + transponders drive pricing). */
export const TollRequestSchema = z
  .object({
    geometry: LineCoordinatesSchema.min(2),
    truck_profile_id: IdSchema,
    departure_time: IsoDateTimeSchema,
    route_id: IdSchema.optional(),
  })
  .strict();
export type TollRequest = z.infer<typeof TollRequestSchema>;

export const TollItemSchema = z.object({
  facility: z.string().min(1),
  amount: z.number().nonnegative(),
  payment: z.enum(['TRANSPONDER', 'CASH', 'TOLL_BY_PLATE']),
});
export type TollItem = z.infer<typeof TollItemSchema>;

export const TollEstimateSchema = ProfileRefSchema.extend({
  toll_estimate_id: IdSchema,
  route_id: IdSchema.nullable(),
  currency: z.literal('USD'),
  total: z.number().nonnegative(),
  items: z.array(TollItemSchema),
  /** Transponder networks from the profile that pricing applied. */
  transponders_applied: z.array(TransponderNetworkSchema),
  /** Estimates are never guarantees — the UI must say so. */
  is_estimate: z.literal(true),
  provider: z.string().min(1),
  computed_at: IsoDateTimeSchema,
  /** True when served from our cache instead of a fresh metered call. */
  cached: z.boolean(),
});
export type TollEstimate = z.infer<typeof TollEstimateSchema>;
