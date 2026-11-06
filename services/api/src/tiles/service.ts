import { createHash } from 'node:crypto';
import { MAPTILER_ATTRIBUTION, OSM_ATTRIBUTION, TileConfigSchema, type Attribution, type TileConfig, type TileSource } from '@drayvision/shared';
import type { AppConfig } from '../../config/index.js';
import { HttpTileUpstream, mockTileUpstream, type TileUpstream } from './upstream.js';

export class TileConfigError extends Error {}

/**
 * Build the active tile upstream from config. Fails at boot (not mid-drive) when:
 *  - the selected source's key / URL is missing, or
 *  - pilot/prod would proxy MapTiler without MapTiler's written approval (Cloud Terms §6).
 */
export function createTileUpstream(config: AppConfig, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): TileUpstream | null {
  const t = config.tiles;
  switch (t.source) {
    case 'mock':
      return mockTileUpstream;
    case 'self-hosted': {
      const url = env.SELF_HOSTED_TILES_URL;
      if (!url) throw new TileConfigError('SELF_HOSTED_TILES_URL is required when tiles.source = self-hosted');
      return new HttpTileUpstream('self-hosted', url, t.selfHosted.stylePath, 'osm', null, fetchImpl);
    }
    case 'maptiler': {
      if (t.delivery === 'direct') {
        if (!env.MAPTILER_CLIENT_KEY) throw new TileConfigError('MAPTILER_CLIENT_KEY (a restricted client key) is required when tiles.delivery = direct');
        return null; // devices talk to MapTiler directly; nothing to proxy
      }
      if (!env.MAPTILER_KEY) throw new TileConfigError('MAPTILER_KEY is required for the maptiler tile proxy');
      if ((config.environment === 'pilot' || config.environment === 'prod') && !t.maptiler.proxyApprovalRef) {
        throw new TileConfigError(
          'Proxying MapTiler needs MapTiler’s written approval (Cloud Terms §6). Set tiles.maptiler.proxyApprovalRef / MAPTILER_PROXY_APPROVAL_REF, ' +
            'or switch TILE_DELIVERY=direct or TILE_SOURCE=self-hosted.',
        );
      }
      return new HttpTileUpstream('maptiler', t.maptiler.baseUrl, `maps/${t.maptiler.styleId}/style.json`, 'maptiler', { param: 'key', value: env.MAPTILER_KEY }, fetchImpl);
    }
  }
}

function attributionFor(source: TileSource): Attribution[] {
  // OSM attribution is required for every source we use (all are OSM-derived).
  return source === 'maptiler' ? [MAPTILER_ATTRIBUTION, OSM_ATTRIBUTION] : [OSM_ATTRIBUTION];
}

/** GET /tiles/config — everything the app needs to render the base map; no app release to change it. */
export function buildTileConfig(config: AppConfig, env: NodeJS.ProcessEnv, publicBase: string): TileConfig {
  const t = config.tiles;
  const base = publicBase.replace(/\/$/, '');
  const direct = t.source === 'maptiler' && t.delivery === 'direct';
  const style_url = direct
    ? `${t.maptiler.baseUrl.replace(/\/$/, '')}/maps/${t.maptiler.styleId}/style.json?key=${encodeURIComponent(env.MAPTILER_CLIENT_KEY ?? '')}`
    : `${base}/tiles/${t.source}/style.json`;
  const body: Omit<TileConfig, 'config_version'> = {
    source: t.source,
    delivery: t.source === 'maptiler' ? t.delivery : 'proxy',
    style_url,
    layer_anchors: !direct,
    attribution: attributionFor(t.source),
    // MapTiler bills this integration (MapLibre Native / our proxy) per request — sessions only
    // exist for MapTiler SDK JS / Leaflet plugin (docs "Map usage: Sessions vs requests").
    billing_unit: t.source === 'maptiler' ? 'request' : 'none',
    device_cache: { ambient_cache_bytes: t.deviceCache.ambientCacheBytes },
    prefetch: {
      // Cloud Terms §6: bulk downloading needs a written agreement.
      enabled: t.source !== 'maptiler' || t.maptiler.bulkDownloadAgreementRef !== null,
      corridor_buffer_m: t.prefetch.corridorBufferM,
      corridor_chunk_m: t.prefetch.corridorChunkM,
      destination_radius_m: t.prefetch.destinationRadiusM,
      min_zoom: t.prefetch.minZoom,
      max_zoom: t.prefetch.maxZoom,
      max_tiles_per_pack: t.prefetch.maxTilesPerPack,
      max_packs: t.prefetch.maxPacks,
    },
    // Cloud Terms §7: no redistributing map content as a screenshot / static image.
    export: { snapshot_allowed: t.source !== 'maptiler' },
    session: { max_duration_s: t.session.maxDurationSeconds, max_requests: t.session.maxRequests },
  };
  const config_version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return TileConfigSchema.parse({ config_version, ...body });
}

/** USD per billable request for the active source, or null when unpriced. */
export function unitCostPerBillable(config: AppConfig): number | null {
  return config.budgets.unitCostUsd.tiles;
}
