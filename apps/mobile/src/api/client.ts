import {
  CamerasResponseSchema,
  FacilitiesResponseSchema,
  MapUsageResponseSchema,
  RestrictionsResponseSchema,
  SponsoredResponseSchema,
  TileConfigSchema,
  TrafficResponseSchema,
  ApiErrorSchema,
  HealthResponseSchema,
  ProfilesResponseSchema,
  RouteResponseSchema,
  TruckProfileSchema,
  type ApiError as ApiErrorBody,
  type Camera,
  type Facility,
  type Hazard,
  type HealthResponse,
  type MapSessionStart,
  type MapUsageResponse,
  type SponsoredListing,
  type TileConfig,
  type TrafficEvent,
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

/** Map calls: tile config, overlay layers, usage analytics. */
export type BBox = readonly [west: number, south: number, east: number, north: number];
export interface MapApi {
  tileConfig(): Promise<TileConfig>;
  reportMapSession(s: MapSessionStart): Promise<void>;
  myMapUsage(day?: string): Promise<MapUsageResponse>;
  restrictions(bbox: BBox): Promise<Hazard[]>;
  traffic(bbox: BBox): Promise<TrafficEvent[]>;
  cameras(bbox: BBox): Promise<Camera[]>;
  facilities(bbox: BBox): Promise<Facility[]>;
  sponsored(bbox: BBox): Promise<SponsoredListing[]>;
}

export type DrayVisionApi = RoutingApi & ProfilesApi & MapApi;

export class ApiClient implements DrayVisionApi {
  constructor(
    readonly baseUrl: string = apiBaseUrl(),
    private deviceId: string = 'unregistered',
    private readonly accountId: string | null = config.account.devAccountId,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** Fallback style URL (active source) until /tiles/config has been fetched. */
  get styleUrl(): string {
    return `${this.baseUrl}/tiles/style.json`;
  }

  /** Stable per-install id, set once loaded from device storage; sent on every request. */
  setDeviceId(id: string): void {
    this.deviceId = id;
  }

  get device(): string {
    return this.deviceId;
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

  // ---- map --------------------------------------------------------------------------------
  tileConfig(): Promise<TileConfig> {
    return this.request(TileConfigSchema, '/tiles/config');
  }

  async reportMapSession(s: MapSessionStart): Promise<void> {
    await this.request(null, '/analytics/map-sessions', { method: 'POST', body: JSON.stringify(s) });
  }

  myMapUsage(day?: string): Promise<MapUsageResponse> {
    return this.request(MapUsageResponseSchema, `/usage/maps/me${day ? `?day=${day}` : ''}`);
  }

  private bbox = (b: BBox): string => `bbox=${b.map((n) => n.toFixed(5)).join(',')}`;

  async restrictions(b: BBox): Promise<Hazard[]> {
    return (await this.request(RestrictionsResponseSchema, `/restrictions?${this.bbox(b)}`)).restrictions;
  }

  async traffic(b: BBox): Promise<TrafficEvent[]> {
    return (await this.request(TrafficResponseSchema, `/traffic?${this.bbox(b)}`)).events;
  }

  async cameras(b: BBox): Promise<Camera[]> {
    return (await this.request(CamerasResponseSchema, `/cameras?${this.bbox(b)}`)).cameras;
  }

  async facilities(b: BBox): Promise<Facility[]> {
    return (await this.request(FacilitiesResponseSchema, `/facilities?${this.bbox(b)}`)).facilities;
  }

  async sponsored(b: BBox): Promise<SponsoredListing[]> {
    return (await this.request(SponsoredResponseSchema, `/sponsored?${this.bbox(b)}`)).listings;
  }
}

export const api = new ApiClient();
