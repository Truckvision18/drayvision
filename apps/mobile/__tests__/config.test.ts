import { ApiClient } from '../src/api/client';
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

  it('API client targets our API only, with a device id', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ status: 'ok' })));
    const c = new ApiClient('http://api.test', 'dev-1', fetchImpl as unknown as typeof fetch);
    await c.health();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/health');
    expect((init.headers as Record<string, string>)['x-device-id']).toBe('dev-1');
    expect(c.styleUrl).toBe('http://api.test/tiles/style.json');
  });
});
