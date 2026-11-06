import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FacilitySchema, HazardSchema, type Facility, type Hazard } from '@drayvision/shared';
import { z } from 'zod';
import type { AppConfig } from '../config/index.js';
import { fromRoot } from './paths.js';

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function readManifest(dir: string): string {
  const p = join(dir, 'manifest.json');
  return existsSync(p) ? z.object({ datasetVersion: z.string() }).parse(readJson(p)).datasetVersion : 'missing';
}

/**
 * Load every `*.json` record file (excluding manifest / schema files) and validate each record
 * against the shared schema. Invalid safety data fails the boot loudly — it is never skipped.
 */
function loadRecords<S extends z.ZodTypeAny>(dir: string, schema: S): Array<z.output<S>> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && !f.endsWith('.schema.json'))
    .sort()
    .flatMap((f) => {
      const parsed = z.object({ records: z.array(schema) }).safeParse(readJson(join(dir, f)));
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 10).map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid data file ${join(dir, f)}:\n${issues}`);
      }
      return parsed.data.records;
    });
}

export interface DataBundle {
  restrictions: Hazard[];
  restrictionsVersion: string;
  facilities: Facility[];
  facilitiesVersion: string;
  routingGraphVersion: string;
}

export function loadData(config: AppConfig): DataBundle {
  const dataDir = fromRoot(config.paths.dataDir);
  const rvFile = fromRoot(config.paths.routingDataVersionFile);
  const routingGraphVersion = existsSync(rvFile) ? z.object({ osmExtractDate: z.string() }).parse(readJson(rvFile)).osmExtractDate : 'not-built';
  return {
    restrictions: loadRecords(join(dataDir, 'restrictions'), HazardSchema),
    restrictionsVersion: readManifest(join(dataDir, 'restrictions')),
    facilities: loadRecords(join(dataDir, 'facilities'), FacilitySchema),
    facilitiesVersion: readManifest(join(dataDir, 'facilities')),
    routingGraphVersion,
  };
}
