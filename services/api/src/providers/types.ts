import type { Camera, Hazard, LineCoordinates, LngLat, Route, TollEstimate, TruckProfile } from '@drayvision/shared';

export type BBox = readonly [minLng: number, minLat: number, maxLng: number, maxLat: number];

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  profile: TruckProfile;
}

/** What a routing engine returns before safety validation / toll enrichment. */
export type RawRoute = Omit<Route, 'validation' | 'hazards' | 'tolls'>;

export interface RoutingProvider {
  readonly name: string;
  route(req: RouteRequest): Promise<RawRoute[]>;
  /** Graph version (OSM extract date) or null if unknown. */
  status(): Promise<{ up: boolean; graphVersion: string | null }>;
}

export interface BinaryResource {
  contentType: string;
  body: Buffer;
}

export interface TileProvider {
  readonly name: string;
  readonly rightsId: string;
  /** Style JSON with every upstream URL rewritten to point at our proxy (no keys leak to clients). */
  style(publicBaseUrl: string): Promise<unknown>;
  /** Fetch an upstream resource by proxied path. JSON resources are rewritten too. */
  resource(path: string, query: URLSearchParams, publicBaseUrl: string): Promise<BinaryResource>;
}

export interface TollProvider {
  readonly name: string;
  readonly rightsId: string;
  estimate(geometry: LineCoordinates, profile: TruckProfile): Promise<Omit<TollEstimate, 'cached'>>;
}

export interface TrafficProvider {
  readonly name: string;
  readonly rightsId: string;
  events(bbox: BBox): Promise<Hazard[]>;
}

export interface CameraProvider {
  readonly name: string;
  readonly rightsId: string;
  list(bbox: BBox): Promise<Camera[]>;
  image(cameraId: string): Promise<BinaryResource>;
}

export interface ImageryProvider {
  readonly name: string;
  readonly rightsId: string;
  preview(location: LngLat, headingDeg: number): Promise<BinaryResource>;
}

export interface Providers {
  routing: RoutingProvider;
  tiles: TileProvider;
  tolls: TollProvider;
  traffic: TrafficProvider;
  cameras: CameraProvider;
  imagery: ImageryProvider;
}

export class ProviderNotImplementedError extends Error {
  readonly statusCode = 501;
  constructor(provider: string, phase: string) {
    super(`${provider} live integration lands in ${phase}; use the mock provider until then`);
  }
}

/** An upstream provider failed or was unreachable. Surfaced to clients as 502 with a safe message. */
export class UpstreamError extends Error {
  constructor(
    provider: string,
    readonly statusCode: 502 | 404 = 502,
    readonly detail?: string,
  ) {
    super(statusCode === 404 ? `${provider}: not found` : `${provider} unavailable`);
  }
}
