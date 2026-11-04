import type { AppConfig } from '../../config/index.js';
import { GoogleImagery, Ny511Cameras, Ny511Traffic, TollSmartTolls } from './live-stubs.js';
import { MapTilerTiles } from './maptiler.js';
import { mockCameras, mockImagery, mockRouting, mockTiles, mockTolls, mockTraffic } from './mock.js';
import type { Providers } from './types.js';
import { ValhallaRouting } from './valhalla.js';

export * from './types.js';
export { mockProviders } from './mock.js';

/** Build providers from config. Missing keys for a selected live provider throw here, at boot. */
export function createProviders(config: AppConfig, env: NodeJS.ProcessEnv = process.env): Providers {
  const p = config.providers;
  return {
    routing:
      p.routing === 'valhalla'
        ? new ValhallaRouting(env.VALHALLA_URL || config.routing.defaultValhallaUrl, config.routing.timeoutMs)
        : mockRouting,
    tiles: p.tiles === 'maptiler' ? new MapTilerTiles(env.MAPTILER_KEY ?? '') : mockTiles,
    tolls: p.tolls === 'tollsmart' ? new TollSmartTolls(env) : mockTolls,
    traffic: p.traffic === 'ny511' ? new Ny511Traffic(env) : mockTraffic,
    cameras: p.cameras === 'ny511' ? new Ny511Cameras(env) : mockCameras,
    imagery: p.imagery === 'google' ? new GoogleImagery(env) : mockImagery,
  };
}
