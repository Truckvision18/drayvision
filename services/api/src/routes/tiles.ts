import { IdSchema, MapSessionStartSchema, type MapUsageResponse, type TileSource } from '@drayvision/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { decideUse } from '../rights/registry.js';
import { buildTileConfig, unitCostPerBillable } from '../tiles/service.js';
import { classify, injectAnchors } from '../tiles/upstream.js';
import { utcDay } from '../tiles/usage.js';
import { BadRequestError, parseBBox, parseBody } from './schemas.js';

/**
 * Base map tiles + map usage analytics.
 *
 *   GET  /tiles/config                 tile source, style URL, attribution, cache / prefetch / export policy
 *   GET  /tiles/style.json             style of the ACTIVE source (back-compat)
 *   GET  /tiles/:source/style.json     style with every upstream URL → our proxy, keys stripped, layer anchors added
 *   GET  /tiles/:source/proxy/*        tiles, TileJSON, fonts, sprites (pass-through; 304s forwarded)
 *   POST /analytics/map-sessions       the app reports each map session it starts
 *   GET  /usage/maps/me?day=           this device's sessions / requests (debug panel)
 *   GET  /usage/maps?day=              all devices (provider-dashboard reconciliation; ops token outside dev/test)
 *   GET  /restrictions?bbox=           verified restrictions in view (hazards layer)
 *
 * Sources are namespaced in the URL, so device caches never mix tiles from two sources and a
 * source switch (config flag) is picked up by the app's next /tiles/config fetch.
 */
export function registerTileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, tiles, mapUsage, meter, cache } = ctx;
  const t = config.tiles;

  const baseOf = (req: FastifyRequest): string => (req.headers.host ? `${req.protocol}://${req.headers.host}` : config.server.publicBaseUrl);
  const header = (req: FastifyRequest, name: string): string | null => {
    const v = req.headers[name];
    const parsed = IdSchema.safeParse(Array.isArray(v) ? v[0] : v);
    return parsed.success ? parsed.data : null;
  };
  const deviceOf = (req: FastifyRequest): string => header(req, 'x-device-id') ?? 'unknown';
  // Account ids are only trusted where the dev header is the auth mechanism.
  const accountOf = (req: FastifyRequest): string | null => (config.auth.mode === 'dev-header' ? header(req, 'x-account-id') : null);

  // ---- config ---------------------------------------------------------------------------------
  app.get('/tiles/config', async (req, reply) => {
    reply.header('cache-control', 'no-cache'); // cheap to revalidate; must reflect a flag flip promptly
    return buildTileConfig(config, ctx.env, baseOf(req));
  });

  // ---- proxy ----------------------------------------------------------------------------------
  async function serve(req: FastifyRequest, reply: FastifyReply, source: string, path: string, query: URLSearchParams): Promise<FastifyReply> {
    const upstream = tiles;
    if (!upstream || upstream.source !== source) {
      throw new HttpError(410, 'TILE_SOURCE_CHANGED', `Tile source "${source}" is not active; refetch /tiles/config.`);
    }
    if (path.includes('..')) throw new BadRequestError('invalid path');
    query.delete('key');

    const day = utcDay(ctx.now());
    const deviceId = deviceOf(req);
    const accountId = accountOf(req);
    const ifNoneMatch = req.headers['if-none-match'] as string | undefined;
    const ifModifiedSince = req.headers['if-modified-since'] as string | undefined;
    const proxyBase = `${baseOf(req)}/tiles/${source}/proxy/`;

    // Server-side caching only where the rights allow it. MapTiler: never (Cloud Terms §7).
    const ttl =
      source === 'self-hosted' ? decideUse(upstream.rightsId, t.selfHosted.serverCacheTtlSeconds, config.rights.allowUnverified).cacheTtlSeconds : 0;
    const cacheKey = `tile:${source}:${baseOf(req)}:${path}?${query.toString()}`;

    let res: { status: number; contentType: string; body: Buffer; etag: string | null; lastModified: string | null } | null = null;
    let wentUpstream = false;
    if (ttl > 0) {
      const hit = await cache.get(cacheKey).catch(() => null);
      if (hit) {
        const c = JSON.parse(hit) as { contentType: string; b64: string; etag: string | null; lastModified: string | null };
        res = { status: 200, contentType: c.contentType, body: Buffer.from(c.b64, 'base64'), etag: c.etag, lastModified: c.lastModified };
      }
    }
    if (!res) {
      if (source === 'maptiler' && meter.budgetState('tiles') === 'hard-stop') {
        throw new HttpError(503, 'BUDGET_EXCEEDED', 'Monthly map budget reached; the base map is paused until the budget resets or is raised.');
      }
      res = await upstream.fetch(path, query, { ifNoneMatch, ifModifiedSince });
      wentUpstream = true;
    }

    const kind = classify(path, res.contentType);
    const billable = source === 'maptiler' && wentUpstream ? t.maptiler.requestWeights[kind] : 0;
    if (billable > 0) meter.recordCall('tiles', billable);
    mapUsage.recordRequest({ day, source: source as TileSource, kind, deviceId, accountId, upstream: wentUpstream, revalidation: res.status === 304, billable });

    const maxAge = kind === 'style' || kind === 'tilejson' ? t.deviceCache.styleMaxAgeSeconds : t.deviceCache.tileMaxAgeSeconds;
    // `private`: single-user device cache only — never a shared/CDN cache.
    reply.header('cache-control', `private, max-age=${maxAge}`);
    if (res.etag) reply.header('etag', res.etag);
    if (res.lastModified) reply.header('last-modified', res.lastModified);
    if (res.status === 304) return reply.code(304).send();

    let body = res.body;
    if (res.contentType.includes('json')) {
      let text = upstream.rewrite(body.toString('utf8'), proxyBase);
      if (kind === 'style') text = JSON.stringify(injectAnchors(JSON.parse(text) as Record<string, unknown>));
      body = Buffer.from(text);
    }
    if (wentUpstream && ttl > 0) {
      await cache
        .set(cacheKey, JSON.stringify({ contentType: res.contentType, b64: res.body.toString('base64'), etag: res.etag, lastModified: res.lastModified }), ttl)
        .catch(() => undefined);
    }
    return reply.type(res.contentType).send(body);
  }

  const queryOf = (req: FastifyRequest) => new URLSearchParams(req.url.split('?')[1] ?? '');

  app.get('/tiles/style.json', async (req, reply) => {
    if (!tiles) throw new HttpError(410, 'TILE_SOURCE_CHANGED', 'Tiles are delivered directly by the provider; read /tiles/config.');
    return serve(req, reply, tiles.source, tiles.stylePath, queryOf(req));
  });
  app.get<{ Params: { source: string } }>('/tiles/:source/style.json', async (req, reply) => {
    if (!tiles || tiles.source !== req.params.source) throw new HttpError(410, 'TILE_SOURCE_CHANGED', `Tile source "${req.params.source}" is not active; refetch /tiles/config.`);
    return serve(req, reply, req.params.source, tiles.stylePath, queryOf(req));
  });
  app.get<{ Params: { source: string; '*': string } }>('/tiles/:source/proxy/*', async (req, reply) => serve(req, reply, req.params.source, req.params['*'], queryOf(req)));

  // ---- analytics ------------------------------------------------------------------------------
  app.post('/analytics/map-sessions', async (req, reply) => {
    const body = parseBody(MapSessionStartSchema, req.body);
    const started = new Date(body.started_at);
    const recorded = await mapUsage.recordSession({
      day: utcDay(started),
      source: t.source,
      sessionId: body.session_id,
      deviceId: deviceOf(req),
      accountId: accountOf(req),
      view: body.view,
      startedAt: started.toISOString(),
    });
    return reply.code(recorded ? 201 : 200).send({ recorded });
  });

  const dayQuery = z.object({ day: z.iso.date().optional() });
  const dayOf = (req: FastifyRequest): string => parseBody(dayQuery, req.query).day ?? utcDay(ctx.now());

  app.get('/usage/maps/me', async (req): Promise<MapUsageResponse> => {
    const day = dayOf(req);
    const deviceId = deviceOf(req);
    const rows = await mapUsage.deviceDay(day, deviceId);
    return {
      device_id: deviceId,
      days: rows.map((r) => ({
        day,
        source: r.source,
        sessions: r.sessions,
        proxy_requests: r.proxy_requests,
        upstream_requests: r.proxy_requests,
        billable_requests: r.billable_requests,
        by_kind: {},
        estimated_cost_usd: r.source === 'maptiler' && unitCostPerBillable(config) !== null ? Math.round(r.billable_requests * unitCostPerBillable(config)! * 1_000_000) / 1_000_000 : null,
      })),
    };
  });

  app.get('/usage/maps', async (req): Promise<MapUsageResponse> => {
    if (config.environment !== 'dev' && config.environment !== 'test') {
      const token = ctx.env.OPS_TOKEN;
      if (!token) throw new HttpError(403, 'UNAUTHENTICATED', 'All-device usage is disabled: set OPS_TOKEN.');
      if (req.headers['x-ops-token'] !== token) throw new HttpError(401, 'UNAUTHENTICATED', 'x-ops-token required');
    }
    const day = dayOf(req);
    return { device_id: null, days: await mapUsage.day(day, unitCostPerBillable(config)), per_device: await mapUsage.perDevice(day) };
  });

  // ---- restrictions (hazards layer) -------------------------------------------------------------
  app.get<{ Querystring: { bbox?: string } }>('/restrictions', async (req) => {
    const bbox = parseBBox(req.query.bbox, true)!;
    const [w, s, e, n] = bbox;
    return {
      restrictions: ctx.data.restrictions.filter((h) => !h.resolved && h.location.lng >= w && h.location.lng <= e && h.location.lat >= s && h.location.lat <= n),
      dataset_version: ctx.data.restrictionsVersion,
    };
  });
}
