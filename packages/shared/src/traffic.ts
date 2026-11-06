import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LngLatSchema, SourceSchema } from './geo.js';

/** Live road events (Phase 7). Distinct from Hazard: events are transient, hazards are structural. */
export const TrafficEventSchema = z.object({
  id: IdSchema,
  kind: z.enum(['INCIDENT', 'CONSTRUCTION', 'CLOSURE', 'CONGESTION', 'WEATHER']),
  severity: z.enum(['INFO', 'CAUTION', 'BLOCKING']),
  location: LngLatSchema,
  description: z.string().min(1),
  starts_at: IsoDateTimeSchema.nullable(),
  ends_at: IsoDateTimeSchema.nullable(),
  source: SourceSchema,
});
export type TrafficEvent = z.infer<typeof TrafficEventSchema>;

export const TrafficResponseSchema = z.object({ events: z.array(TrafficEventSchema), cached: z.boolean() });
