import { UpstreamError, type BinaryResource, type TileProvider } from './types.js';

const UPSTREAM = 'https://api.maptiler.com/';

/**
 * MapTiler via our API. The key is appended server-side only; every upstream URL inside
 * style/TileJSON documents is rewritten to `${publicBaseUrl}/tiles/proxy/...` so the mobile
 * app never sees the key or calls MapTiler directly.
 */
export class MapTilerTiles implements TileProvider {
  readonly name = 'maptiler';
  readonly rightsId = 'maptiler';

  constructor(
    private readonly key: string,
    private readonly styleId: string = 'streets-v2',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!key) throw new Error('MAPTILER_KEY is required for the maptiler tile provider');
  }

  static rewrite(text: string, publicBaseUrl: string): string {
    const proxied = `${publicBaseUrl.replace(/\/$/, '')}/tiles/proxy/`;
    return text
      .split(UPSTREAM)
      .join(proxied)
      .replace(/([?&])key=[^&"\s]*&?/g, (_m, sep: string) => (sep === '?' ? '?' : '&'))
      .replace(/[?&]"/g, '"');
  }

  async style(publicBaseUrl: string): Promise<unknown> {
    const r = await this.resource(`maps/${this.styleId}/style.json`, new URLSearchParams(), publicBaseUrl);
    return JSON.parse(r.body.toString('utf8'));
  }

  async resource(path: string, query: URLSearchParams, publicBaseUrl: string): Promise<BinaryResource> {
    const q = new URLSearchParams(query);
    q.delete('key');
    q.set('key', this.key);
    const url = `${UPSTREAM}${path.replace(/^\//, '')}?${q.toString()}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (err) {
      throw new UpstreamError('tile provider', 502, err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) throw new UpstreamError('tile provider', res.status === 404 ? 404 : 502, `HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    let body = Buffer.from(await res.arrayBuffer());
    if (contentType.includes('json')) body = Buffer.from(MapTilerTiles.rewrite(body.toString('utf8'), publicBaseUrl));
    return { contentType, body };
  }
}
