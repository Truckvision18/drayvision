import type { HealthResponse, Route } from '@drayvision/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { meteredCall, stableKey } from '../cache/metered.js';
import type { AppContext } from '../context.js';
import { RIGHTS_REGISTRY_VERSION } from '../rights/registry.js';
import { validateRoute } from '../safety/validate.js';
import { BadRequestError, lineCoordinates, lngLat, parseBBox, parseBody, truckProfile } from './schemas.js';

/** Register every HTTP route. Each group is small on purpose — later phases grow them. */
export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, providers, cache, meter, repo, data } = ctx;
  const deps = { cache, meter, config };
  /**
   * Base URL the client used to reach us (so an Android emulator on 10.0.2.2 gets URLs it can
   * resolve). Falls back to config.server.publicBaseUrl when no Host header is present.
   */
  const baseOf = (req: FastifyRequest): string =>
    req.headers.host ? `${req.protocol}://${req.headers.host}` : config.server.publicBaseUrl;

  // ---- /health ---------------------------------------------------------------------------
  app.get('/health', async (): Promise<HealthResponse> => {
    const [dbUp, cacheUp, routing] = await Promise.all([repo.ping(), cache.ping(), providers.routing.status()]);
    const dependencies: HealthResponse['dependencies'] = {
      db: ctx.external.db ? (dbUp ? 'up' : 'down') : 'not-configured',
      cache: ctx.external.cache ? (cacheUp ? 'up' : 'down') : 'not-configured',
      routing: providers.routing.name === 'mock' ? 'not-configured' : routing.up ? 'up' : 'down',
    };
    // Routing being down is "degraded" until Phase 4 ships a graph; db/cache down is degraded too.
    const status = Object.values(dependencies).includes('down') ? 'degraded' : 'ok';
    return {
      status,
      service: 'drayvision-api',
      version: ctx.build.version,
      gitSha: ctx.build.gitSha,
      environment: config.environment,
      dataVersions: {
        routingGraph: routing.graphVersion ?? data.routingGraphVersion,
        restrictions: data.restrictionsVersion,
        facilities: data.facilitiesVersion,
        rightsRegistry: RIGHTS_REGISTRY_VERSION,
      },
      dependencies,
      time: ctx.now().toISOString(),
    };
  });

  // ---- /meter (ops) ----------------------------------------------------------------------
  app.get('/meter', async () => meter.snapshot());

  // ---- /route ----------------------------------------------------------------------------
  const routeBody = z.object({ origin: lngLat, destination: lngLat, profile: truckProfile, includeTolls: z.boolean().optional() });
  app.post('/route', async (req) => {
    const body = parseBody(routeBody, req.body);
    const raws = await providers.routing.route(body);
    const routes: Route[] = [];
    for (const raw of raws) {
      const { hazards, validation } = validateRoute(raw, body.profile, data.restrictions, data.restrictionsVersion, config.safety, ctx.now());
      const route: Route = { ...raw, hazards, validation };
      if (body.includeTolls) {
        const t = await meteredCall(
          deps,
          { provider: 'tolls', rightsId: providers.tolls.rightsId, key: stableKey({ g: raw.geometry, p: body.profile }) },
          () => providers.tolls.estimate(raw.geometry, body.profile),
        );
        route.tolls = { ...t.value, cached: t.cached };
      }
      routes.push(route);
    }
    const navigable = config.safety.blockOnFail ? routes.filter((r) => r.validation.status !== 'fail') : routes;
    return { routes: navigable, rejected: routes.filter((r) => !navigable.includes(r)).map((r) => ({ id: r.id, validation: r.validation })) };
  });

  // ---- /tolls ----------------------------------------------------------------------------
  const tollBody = z.object({ geometry: lineCoordinates, profile: truckProfile });
  app.post('/tolls', async (req) => {
    const body = parseBody(tollBody, req.body);
    const geometry = body.geometry as Array<[number, number]>;
    const r = await meteredCall(
      deps,
      { provider: 'tolls', rightsId: providers.tolls.rightsId, key: stableKey({ g: geometry, p: body.profile }) },
      () => providers.tolls.estimate(geometry, body.profile),
    );
    return { ...r.value, cached: r.cached };
  });

  // ---- /traffic --------------------------------------------------------------------------
  app.get<{ Querystring: { bbox?: string } }>('/traffic', async (req) => {
    const bbox = parseBBox(req.query.bbox, true)!;
    const r = await meteredCall(deps, { provider: 'traffic', rightsId: providers.traffic.rightsId, key: bbox.join(',') }, () =>
      providers.traffic.events(bbox),
    );
    return { events: r.value, cached: r.cached };
  });

  // ---- /cameras --------------------------------------------------------------------------
  app.get<{ Querystring: { bbox?: string } }>('/cameras', async (req) => {
    const base = baseOf(req);
    const bbox = parseBBox(req.query.bbox, true)!;
    const r = await meteredCall(deps, { provider: 'cameras', rightsId: providers.cameras.rightsId, key: `list:${bbox.join(',')}` }, () =>
      providers.cameras.list(bbox),
    );
    // Always point clients at OUR image endpoint, never the upstream URL.
    const cameras = r.value.map((c) => ({ ...c, imageUrl: `${base}/cameras/${encodeURIComponent(c.id)}/image` }));
    return { cameras, cached: r.cached };
  });

  app.get<{ Params: { id: string } }>('/cameras/:id/image', async (req, reply) => {
    const r = await meteredCall(deps, { provider: 'cameras', rightsId: providers.cameras.rightsId, key: `img:${req.params.id}` }, async () => {
      const img = await providers.cameras.image(req.params.id);
      return { contentType: img.contentType, b64: img.body.toString('base64') };
    });
    return reply.type(r.value.contentType).send(Buffer.from(r.value.b64, 'base64'));
  });

  // ---- /imagery (Know Before You Go previews) --------------------------------------------
  app.get<{ Querystring: { lng?: string; lat?: string; heading?: string } }>('/imagery/preview', async (req, reply) => {
    const loc = parseBody(lngLat, { lng: Number(req.query.lng), lat: Number(req.query.lat) });
    const heading = Number(req.query.heading ?? 0);
    if (!Number.isFinite(heading)) throw new BadRequestError('heading must be a number');
    const r = await meteredCall(
      deps,
      { provider: 'imagery', rightsId: providers.imagery.rightsId, key: stableKey({ loc, heading }) },
      async () => {
        const img = await providers.imagery.preview(loc, heading);
        return { contentType: img.contentType, b64: img.body.toString('base64') };
      },
    );
    return reply.type(r.value.contentType).send(Buffer.from(r.value.b64, 'base64'));
  });

  // ---- /facilities -----------------------------------------------------------------------
  app.get<{ Querystring: { bbox?: string } }>('/facilities', async (req) => ({ facilities: await repo.facilities(parseBBox(req.query.bbox)) }));
  app.get<{ Params: { id: string } }>('/facilities/:id', async (req, reply) => {
    const f = await repo.facility(req.params.id);
    return f ?? reply.code(404).send({ error: 'not found' });
  });

  // ---- /ports ----------------------------------------------------------------------------
  app.get('/ports', async () => {
    const ports = (await repo.facilities(null)).filter((f) => f.kind === 'port-terminal');
    const waits = await repo.latestWaitTimes(ports.map((p) => p.id));
    return { ports: ports.map((p) => ({ ...p, latestWait: waits.find((w) => w.facilityId === p.id) ?? null })) };
  });

  // ---- /sponsored ------------------------------------------------------------------------
  app.get<{ Querystring: { bbox?: string } }>('/sponsored', async (req) => {
    const listings = await repo.sponsored(parseBBox(req.query.bbox), ctx.now());
    // Sponsored content is ALWAYS labelled, whatever the DB says.
    return { listings: listings.map((l) => ({ ...l, label: 'Sponsored' as const })) };
  });

  // ---- /tiles (MapTiler proxy — keys never reach the client) -----------------------------
  app.get('/tiles/style.json', async (req) => {
    const base = baseOf(req);
    const r = await meteredCall(deps, { provider: 'tiles', rightsId: providers.tiles.rightsId, key: `style:${base}` }, () =>
      providers.tiles.style(base),
    );
    return r.value;
  });

  app.get<{ Params: { '*': string } }>('/tiles/proxy/*', async (req, reply) => {
    const path = req.params['*'];
    if (path.includes('..')) throw new BadRequestError('invalid path');
    const query = new URLSearchParams(req.url.split('?')[1] ?? '');
    query.delete('key');
    const base = baseOf(req);
    const r = await meteredCall(deps, { provider: 'tiles', rightsId: providers.tiles.rightsId, key: `${base}|${path}?${query.toString()}` }, async () => {
      const res = await providers.tiles.resource(path, query, base);
      return { contentType: res.contentType, b64: res.body.toString('base64') };
    });
    return reply.type(r.value.contentType).send(Buffer.from(r.value.b64, 'base64'));
  });
}
