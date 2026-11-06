import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, LngLatSchema } from './geo.js';

export const CameraSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  location: LngLatSchema,
  /** Compass heading the camera faces, degrees, if known. */
  heading_deg: z.number().min(0).max(360).nullable(),
  /** Feed provider key, e.g. "ny511". */
  provider: z.string().min(1),
  /** Always OUR API's image endpoint — never the upstream URL. */
  image_url: z.string().url().nullable(),
  last_updated: IsoDateTimeSchema.nullable(),
  rights_id: z.string().min(1),
  attribution: z.string().min(1),
});
export type Camera = z.infer<typeof CameraSchema>;

export const CamerasResponseSchema = z.object({ cameras: z.array(CameraSchema), cached: z.boolean() });
