import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('GET /health', () => {
  it('returns data-version info with no live keys', async () => {
    const { app } = testApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'ok',
      service: 'drayvision-api',
      environment: 'test',
      data_versions: {
        routing_graph: 'mock',
        restrictions: 'test-restrictions-1',
        facilities: 'test-facilities-1',
        rights_registry: expect.any(String),
      },
      dependencies: { db: 'not-configured', cache: 'not-configured', routing: 'not-configured' },
    });
  });

  it('reports degraded when the router is down', async () => {
    const { app } = testApp({
      providers: {
        routing: { name: 'valhalla', route: async () => [], status: async () => ({ up: false, graphVersion: null }) },
      },
    });
    const body = (await app.inject({ method: 'GET', url: '/health' })).json();
    expect(body.status).toBe('degraded');
    expect(body.data_versions.routing_graph).toBe('not-built');
  });
});
