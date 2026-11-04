import Fastify, { type FastifyInstance } from 'fastify';
import { RateLimiter } from './cache/rateLimit.js';
import type { AppContext } from './context.js';
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
      return reply.code(429).send({ error: 'rate limited', group });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    // 501/502/503 messages are written by us to be client-safe; any other 5xx is opaque.
    const expose = status < 500 || status === 501 || status === 502 || status === 503;
    void reply.code(status).send({ error: expose ? err.message : 'internal error' });
  });

  registerRoutes(app, ctx);
  return app;
}
