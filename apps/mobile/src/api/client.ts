import type { HealthResponse, Route, TruckProfile, LngLat } from '@drayvision/shared';
import { apiBaseUrl, config } from '../config';

/**
 * The ONLY network client in the app. It talks to the DrayVision API, which holds every
 * metered key, caches, and meters. Do not add direct calls to tile/toll/traffic/imagery vendors.
 */
export class ApiClient {
  constructor(
    readonly baseUrl: string = apiBaseUrl(),
    private readonly deviceId: string = 'unregistered',
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** MapLibre style URL served (and key-stripped) by our API's tile proxy. */
  get styleUrl(): string {
    return `${this.baseUrl}/tiles/style.json`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.api.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-device-id': this.deviceId, ...(init.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<HealthResponse> {
    return this.request('/health');
  }

  route(origin: LngLat, destination: LngLat, profile: TruckProfile): Promise<{ routes: Route[] }> {
    return this.request('/route', { method: 'POST', body: JSON.stringify({ origin, destination, profile }) });
  }
}

export const api = new ApiClient();
