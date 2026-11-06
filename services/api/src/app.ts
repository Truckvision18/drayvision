import Fastify, { type FastifyInstance } from 'fastify';
import { RateLimiter } from './cache/rateLimit.js';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { registerRoutes } from './routes/index.js';

/** Map a URL to its rate-limit group (keys of config.rateLimits.perDevice). */
function limitGroup(url: string): keyof AppContext['config']['rateLimits']['perDevice'] {
  const seg = url.split('?')[0]?.split('/')[1] ?? '';
  switch (seg) {
    case 'route':
    case 'tolls':
    case 'traffic':
    case 'cameras':
    case 'facilities':
    case 'tiles':
      return seg;
    case 'ports':
    case 'sponsored':
      return 'facilities';
    case 'imagery':
      return 'cameras';
    case 'profiles':
    case 'safety':
    case 'analytics':
    case 'usage':
      return 'default';
    case 'restrictions':
      return 'facilities';
    default:
      return 'default';
  }
}

export function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}): FastifyInstance {
  const { config } = ctx;
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: config.server.bodyLimitBytes,
    requestTimeout: config.server.requestTimeoutMs,
    trustProxy: true,
  });

  const limiter = new RateLimiter(config.rateLimits.windowSeconds);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const group = limitGroup(req.url);
    const device = (req.headers['x-device-id'] as string | undefined) ?? req.ip;
    if (!limiter.take(`${group}:${device}`, config.rateLimits.perDevice[group])) {
      return reply.code(429).send({ error: 'RATE_LIMITED', message: `Too many ${group} requests; slow down.` });
    }
  });

  // Every error leaves as the shared ApiError payload: { error: CODE, message, ...extra }.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode >= 500 && err.statusCode !== 501) req.log.error(err);
      return reply.code(err.statusCode).send(err.toBody());
    }
    // Fastify's own client errors (malformed JSON, body too large, wrong content type).
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'BAD_REQUEST', message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'internal error' });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'NOT_FOUND', message: `No route ${req.method} ${req.url.split('?')[0]}` }));

  registerRoutes(app, ctx);
  return app;
}
