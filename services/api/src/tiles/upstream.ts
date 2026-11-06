import { layerAnchorId, MAP_LAYER_ORDER, type TileSource } from '@drayvision/shared';
import { UpstreamError } from '../providers/types.js';

/** How MapTiler counts requests, per resource kind (keys of config.tiles.maptiler.requestWeights). */
export type ResourceKind = 'style' | 'tilejson' | 'font' | 'sprite' | 'vector_tile' | 'raster_tile_512' | 'raster_tile_256' | 'other';

/** Classify a proxied path the way the provider's billing table does. */
export function classify(path: string, contentType: string | null): ResourceKind {
  const p = path.toLowerCase().split('?')[0]!;
  if (p.endsWith('style.json')) return 'style';
  if (/(^|\/)(fonts|glyphs)\//.test(p)) return 'font';
  if (p.includes('sprite')) return 'sprite';
  if (p.endsWith('.json')) return 'tilejson';
  const ct = (contentType ?? '').toLowerCase();
  if (/\.(pbf|mvt)$/.test(p) || ct.includes('protobuf') || ct.includes('vnd.mapbox-vector-tile')) return 'vector_tile';
  if (/\.(png|jpe?g|webp)$/.test(p) || ct.startsWith('image/')) return /\/256\//.test(p) ? 'raster_tile_256' : 'raster_tile_512';
  return 'other';
}

export interface UpstreamResponse {
  status: number; // 200 or 304
  contentType: string;
  body: Buffer;
  etag: string | null;
  lastModified: string | null;
}

/** Conditional-request headers we pass through so on-device caches can revalidate cheaply. */
export interface Conditional {
  ifNoneMatch?: string | undefined;
  ifModifiedSince?: string | undefined;
}

export interface TileUpstream {
  readonly source: TileSource;
  readonly rightsId: string;
  /** Path (relative to the upstream base) of the style document. */
  readonly stylePath: string;
  fetch(path: string, query: URLSearchParams, cond: Conditional): Promise<UpstreamResponse>;
  /** Rewrite every upstream URL in a JSON document to our proxy, and strip any key. */
  rewrite(text: string, proxyBase: string): string;
}

/**
 * Generic HTTP tile upstream: MapTiler today, our own tile server later. The key (if any) is
 * appended server-side and stripped from anything we send back, so it never reaches a device.
 */
export class HttpTileUpstream implements TileUpstream {
  private readonly base: string;

  constructor(
    readonly source: 'maptiler' | 'self-hosted',
    baseUrl: string,
    readonly stylePath: string,
    readonly rightsId: string,
    private readonly key: { param: string; value: string } | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  rewrite(text: string, proxyBase: string): string {
    let out = text.split(this.base).join(proxyBase);
    if (this.key) {
      const k = this.key.param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`([?&])${k}=[^&"\\s]*&?`, 'g'), (_m, sep: string) => (sep === '?' ? '?' : '&')).replace(/[?&]"/g, '"');
    }
    return out;
  }

  async fetch(path: string, query: URLSearchParams, cond: Conditional): Promise<UpstreamResponse> {
    const q = new URLSearchParams(query);
    if (this.key) {
      q.delete(this.key.param);
      q.set(this.key.param, this.key.value);
    }
    const qs = q.toString();
    const url = `${this.base}${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {};
    if (cond.ifNoneMatch) headers['if-none-match'] = cond.ifNoneMatch;
    if (cond.ifModifiedSince) headers['if-modified-since'] = cond.ifModifiedSince;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers });
    } catch (err) {
      throw new UpstreamError('tile provider', 502, err instanceof Error ? err.message : String(err));
    }
    if (res.status !== 304 && !res.ok) throw new UpstreamError('tile provider', res.status === 404 ? 404 : 502, `HTTP ${res.status}`);
    return {
      status: res.status === 304 ? 304 : 200,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      body: res.status === 304 ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer()),
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  }
}

// 1x1 transparent PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** In-process upstream for tests and keyless dev: an "empty map" (background only). */
export const mockTileUpstream: TileUpstream = {
  source: 'mock',
  rightsId: 'osm',
  stylePath: 'style.json',
  rewrite: (text) => text,
  async fetch(path) {
    if (path.endsWith('style.json')) {
      const style = {
        version: 8,
        name: 'DrayVision empty (mock)',
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9e5dc' } }],
      };
      return { status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(style)), etag: null, lastModified: null };
    }
    return { status: 200, contentType: 'image/png', body: PIXEL, etag: '"mock-pixel"', lastModified: null };
  },
};

const EMPTY_SOURCE = 'dv-empty';

/**
 * Append empty anchor layers, in MAP_LAYER_ORDER, on top of the base style. The app inserts
 * each overlay *below* the anchor of the layer above it, so the on-map stack is always
 * base → route → hazards → traffic → cameras → facilities → sponsored, whatever mounts first.
 */
export function injectAnchors(style: Record<string, unknown>): Record<string, unknown> {
  const sources = { ...((style.sources as Record<string, unknown>) ?? {}), [EMPTY_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } };
  const base = ((style.layers as Array<{ id: string }>) ?? []).filter((l) => !l.id.startsWith('dv-anchor-'));
  const anchors = [...MAP_LAYER_ORDER, 'top' as const].map((id) => ({ id: layerAnchorId(id), type: 'symbol', source: EMPTY_SOURCE, layout: {} }));
  return { ...style, sources, layers: [...base, ...anchors] };
}
