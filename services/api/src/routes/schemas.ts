import type { z } from 'zod';
import { BadRequestError } from '../errors.js';
import type { BBox } from '../providers/types.js';

export { BadRequestError };

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

/** Validate a request body/params against a shared schema; 400 BAD_REQUEST listing every problem. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestError(r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; '));
  return r.data;
}
