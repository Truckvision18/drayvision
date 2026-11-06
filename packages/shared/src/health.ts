import { z } from 'zod';
import { IsoDateTimeSchema } from './geo.js';

const dep = z.enum(['up', 'down', 'not-configured']);

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('drayvision-api'),
  version: z.string(),
  git_sha: z.string(),
  environment: z.string(),
  data_versions: z.object({
    /** OSM extract date the Valhalla graph was built from, or "not-built". */
    routing_graph: z.string(),
    restrictions: z.string(),
    facilities: z.string(),
    rights_registry: z.string(),
  }),
  dependencies: z.object({ db: dep, cache: dep, routing: dep }),
  time: IsoDateTimeSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
