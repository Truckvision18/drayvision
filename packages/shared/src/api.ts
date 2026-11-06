import { z } from 'zod';
import { REQUIRED_PROFILE_FIELDS, TruckProfileSchema } from './truck.js';

/** Machine-readable error codes. Clients switch on `error`, show `message`. */
export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'PROFILE_NOT_FOUND',
  'PROFILE_INCOMPLETE',
  'PROFILE_LIMIT_REACHED',
  'VERSION_CONFLICT',
  'FACILITY_NO_TRUCK_ENTRANCE',
  'NO_ROUTE',
  'RATE_LIMITED',
  'RIGHTS_DENIED',
  'BUDGET_EXCEEDED',
  'NOT_IMPLEMENTED',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: ApiErrorCodeSchema,
  message: z.string(),
  /** PROFILE_INCOMPLETE only. */
  missing_fields: z.array(z.enum(REQUIRED_PROFILE_FIELDS)).optional(),
  /** VERSION_CONFLICT only: the server's current version. */
  current_version: z.number().int().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ProfilesResponseSchema = z.object({ profiles: z.array(TruckProfileSchema) });
