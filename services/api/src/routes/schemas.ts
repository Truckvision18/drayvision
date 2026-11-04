import { z } from 'zod';
import type { BBox } from '../providers/types.js';

export const lngLat = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

export const truckProfile = z.object({
  id: z.string().min(1),
  name: z.string(),
  heightM: z.number().positive(),
  widthM: z.number().positive(),
  lengthM: z.number().positive(),
  grossWeightKg: z.number().positive(),
  axleCount: z.number().int().min(2),
  axleLoadKg: z.number().positive().optional(),
  chassis: z.enum(['20ft', '40ft', '45ft', '53ft', 'tri-axle', 'flatbed', 'other']),
  hazmat: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9)])),
  twic: z.boolean(),
});

export const lineCoordinates = z.array(z.tuple([z.number(), z.number()])).min(2);

export class BadRequestError extends Error {
  readonly statusCode = 400;
}

/** Parse `bbox=minLng,minLat,maxLng,maxLat`. Returns null if absent. */
export function parseBBox(raw: unknown, required = false): BBox | null {
  if (raw === undefined || raw === '') {
    if (required) throw new BadRequestError('bbox is required: minLng,minLat,maxLng,maxLat');
    return null;
  }
  const parts = String(raw).split(',').map(Number);
  const [a, b, c, d] = parts;
  if (parts.length !== 4 || a === undefined || b === undefined || c === undefined || d === undefined || parts.some((n) => !Number.isFinite(n))) {
    throw new BadRequestError('bbox must be minLng,minLat,maxLng,maxLat');
  }
  if (a > c || b > d) throw new BadRequestError('bbox min must be <= max');
  return [a, b, c, d];
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestError(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
