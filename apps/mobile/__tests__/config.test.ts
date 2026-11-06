import { ApiClient, ApiError } from '../src/api/client';
import { buildConfig } from '../src/config';

describe('mobile config', () => {
  it('applies per-environment overrides over defaults', () => {
    const dev = buildConfig('dev');
    const pilot = buildConfig('pilot');
    expect(pilot.api.baseUrl.ios).not.toBe(dev.api.baseUrl.ios);
    expect(pilot.safety).toEqual(dev.safety);
  });

  it('keeps safety thresholds coherent', () => {
    const { safety } = buildConfig('prod');
    expect(safety.parkedSpeedMps).toBeLessThan(safety.movingSpeedMps);
    expect(safety.parkedDwellSeconds).toBeGreaterThan(0);
  });

  it('has no built-in truck profile to fall back on', () => {
    expect(Object.keys(buildConfig('dev'))).not.toContain('defaultTruckProfile');
  });

  it('pilot/prod never send the shared dev account id', () => {
    expect(buildConfig('pilot').account.devAccountId).toBeNull();
    expect(buildConfig('prod').account.devAccountId).toBeNull();
  });
});

const health = {
  status: 'ok',
  service: 'drayvision-api',
  version: '0.1.0',
  git_sha: 'x',
  environment: 'dev',
  data_versions: { routing_graph: 'g', restrictions: 'r', facilities: 'f', rights_registry: 'rr' },
  dependencies: { db: 'up', cache: 'up', routing: 'up' },
  time: '2026-11-06T12:00:00Z',
};

describe('ApiClient', () => {
  const client = (fetchImpl: jest.Mock) => new ApiClient('http://api.test', 'dev-1', 'acct-1', fetchImpl as unknown as typeof fetch);

  it('targets our API only, with device and (dev) account headers', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(health)));
    const c = client(fetchImpl);
    await c.health();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/health');
    expect(init.headers).toMatchObject({ 'x-device-id': 'dev-1', 'x-account-id': 'acct-1' });
    expect(c.styleUrl).toBe('http://api.test/tiles/style.json');
  });

  it('validates responses against the shared schemas — a drifted payload is rejected', async () => {
    const c = client(jest.fn(async () => new Response(JSON.stringify({ ...health, data_versions: undefined }))));
    await expect(c.health()).rejects.toThrow();
  });

  it('surfaces typed API errors (code + message + missing fields)', async () => {
    const body = { error: 'PROFILE_INCOMPLETE', message: 'Complete your truck profile: add height before DrayVision can plan a route.', missing_fields: ['height_m'] };
    const c = client(jest.fn(async () => new Response(JSON.stringify(body), { status: 422 })));
    const err = await c.route({ origin: { lng: 0, lat: 0 }, destination_coords: { lng: 1, lat: 1 }, truck_profile_id: 'p', departure_time: '2026-11-06T12:00:00Z' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'PROFILE_INCOMPLETE', body: { missing_fields: ['height_m'] } });
  });
});
