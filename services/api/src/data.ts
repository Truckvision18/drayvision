import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Facility, Hazard } from '@drayvision/shared';
import type { AppConfig } from '../config/index.js';
import { fromRoot } from './paths.js';

interface Manifest {
  datasetVersion: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readManifest(dir: string): string {
  const p = join(dir, 'manifest.json');
  return existsSync(p) ? readJson<Manifest>(p).datasetVersion : 'missing';
}

/** Load all `*.json` record files (excluding manifest/schema files) from a data directory. */
function loadRecords<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && !f.endsWith('.schema.json'))
    .sort()
    .flatMap((f) => readJson<{ records: T[] }>(join(dir, f)).records);
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
  const routingGraphVersion = existsSync(rvFile) ? readJson<{ osmExtractDate: string }>(rvFile).osmExtractDate : 'not-built';
  return {
    restrictions: loadRecords<Hazard>(join(dataDir, 'restrictions')),
    restrictionsVersion: readManifest(join(dataDir, 'restrictions')),
    facilities: loadRecords<Facility>(join(dataDir, 'facilities')),
    facilitiesVersion: readManifest(join(dataDir, 'facilities')),
    routingGraphVersion,
  };
}
