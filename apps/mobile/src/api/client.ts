import {
  ApiErrorSchema,
  HealthResponseSchema,
  ProfilesResponseSchema,
  RouteResponseSchema,
  TruckProfileSchema,
  type ApiError as ApiErrorBody,
  type HealthResponse,
  type RouteRequest,
  type RouteResponse,
  type TruckProfile,
  type TruckProfileCreate,
  type TruckProfileUpdate,
} from '@drayvision/shared';
import type { z } from 'zod';
import { apiBaseUrl, config } from '../config';

/**
 * The ONLY network client in the app. It talks to the DrayVision API, which holds every
 * metered key, caches, and meters. Do not add direct calls to tile/toll/traffic/imagery vendors.
 * Every response is validated against the shared schemas — a drifted server fails loudly here.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
  get code(): ApiErrorBody['error'] {
    return this.body.error;
  }
}

/** The routing calls the navigation layer needs — an interface so tests can fake it. */
export interface RoutingApi {
  route(req: RouteRequest): Promise<RouteResponse>;
}

/** Profile calls — server is the source of truth; the device caches. */
export interface ProfilesApi {
  listProfiles(): Promise<TruckProfile[]>;
  createProfile(input: TruckProfileCreate): Promise<TruckProfile>;
  updateProfile(id: string, patch: TruckProfileUpdate): Promise<TruckProfile>;
  setDefaultProfile(id: string): Promise<TruckProfile>;
  deleteProfile(id: string): Promise<void>;
}

export class ApiClient implements RoutingApi, ProfilesApi {
  constructor(
    readonly baseUrl: string = apiBaseUrl(),
    private readonly deviceId: string = 'unregistered',
    private readonly accountId: string | null = config.account.devAccountId,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** MapLibre style URL served (and key-stripped) by our API's tile proxy. */
  get styleUrl(): string {
    return `${this.baseUrl}/tiles/style.json`;
  }

  private async request<S extends z.ZodTypeAny | null>(schema: S, path: string, init: RequestInit = {}): Promise<S extends z.ZodTypeAny ? z.output<S> : void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.api.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-device-id': this.deviceId,
          ...(this.accountId ? { 'x-account-id': this.accountId } : {}),
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
        throw new ApiError(res.status, parsed.success ? parsed.data : { error: 'INTERNAL', message: `API ${path} → ${res.status}` });
      }
      if (schema === null || res.status === 204) return undefined as never;
      return (schema as z.ZodTypeAny).parse(await res.json()) as never;
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<HealthResponse> {
    return this.request(HealthResponseSchema, '/health');
  }

  route(req: RouteRequest): Promise<RouteResponse> {
    return this.request(RouteResponseSchema, '/route', { method: 'POST', body: JSON.stringify(req) });
  }

  async listProfiles(): Promise<TruckProfile[]> {
    return (await this.request(ProfilesResponseSchema, '/profiles')).profiles;
  }

  createProfile(input: TruckProfileCreate): Promise<TruckProfile> {
    return this.request(TruckProfileSchema, '/profiles', { method: 'POST', body: JSON.stringify(input) });
  }

  updateProfile(id: string, patch: TruckProfileUpdate): Promise<TruckProfile> {
    return this.request(TruckProfileSchema, `/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  setDefaultProfile(id: string): Promise<TruckProfile> {
    return this.request(TruckProfileSchema, `/profiles/${encodeURIComponent(id)}/default`, { method: 'POST' });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.request(null, `/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
