import type { MobileEnvironment } from './types';

/**
 * Which environment this build targets. Debug builds are always `dev`; release pipelines
 * overwrite this file (or swap it via a babel alias) to `pilot` / `prod`.
 */
export const BUILD_ENV: MobileEnvironment = 'dev';
