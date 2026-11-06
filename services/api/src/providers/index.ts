import type { AppConfig } from '../../config/index.js';
import { GoogleImagery, Ny511Cameras, Ny511Traffic, TollSmartTolls } from './live-stubs.js';
import { mockCameras, mockImagery, mockRouting, mockTolls, mockTraffic } from './mock.js';
import type { Providers } from './types.js';
import { ValhallaRouting } from './valhalla.js';

export * from './types.js';
export { mockProviders } from './mock.js';

/** Build providers from config. Missing keys for a selected live provider throw here, at boot. */
export function createProviders(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: { routingGraphVersion?: string } = {},
): Providers {
  const p = config.providers;
  return {
    routing:
      p.routing === 'valhalla'
        ? new ValhallaRouting({
            baseUrl: env.VALHALLA_URL || config.routing.defaultValhallaUrl,
            timeoutMs: config.routing.timeoutMs,
            alternates: config.routing.alternates,
            truckCosting: config.routing.truckCosting,
            graphVersion: opts.routingGraphVersion ?? 'not-built',
          })
        : mockRouting,
    tolls: p.tolls === 'tollsmart' ? new TollSmartTolls(env) : mockTolls,
    traffic: p.traffic === 'ny511' ? new Ny511Traffic(env) : mockTraffic,
    cameras: p.cameras === 'ny511' ? new Ny511Cameras(env) : mockCameras,
    imagery: p.imagery === 'google' ? new GoogleImagery(env) : mockImagery,
  };
}
