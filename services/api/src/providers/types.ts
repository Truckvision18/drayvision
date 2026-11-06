import type { Camera, CompleteTruckProfile, EngineRoute, LineCoordinates, LngLat, TollItem, TrafficEvent, TransponderNetwork } from '@drayvision/shared';
import { HttpError } from '../errors.js';

export type BBox = readonly [minLng: number, minLat: number, maxLng: number, maxLat: number];

/** What the engine is asked. Only a COMPLETE profile can ever reach a routing engine. */
export interface EngineRouteRequest {
  origin: LngLat;
  destination: LngLat;
  profile: CompleteTruckProfile;
}

/** Engine output shape — defined once in @drayvision/shared. */
export type { EngineRoute };

export interface RoutingProvider {
  readonly name: string;
  route(req: EngineRouteRequest): Promise<EngineRoute[]>;
  /** Graph version (OSM extract date) or null if unknown. */
  status(): Promise<{ up: boolean; graphVersion: string | null }>;
}

export interface BinaryResource {
  contentType: string;
  body: Buffer;
}

export interface TollProvider {
  readonly name: string;
  readonly rightsId: string;
  estimate(
    geometry: LineCoordinates,
    profile: CompleteTruckProfile,
  ): Promise<{ total: number; items: TollItem[]; transponders_applied: TransponderNetwork[]; provider: string }>;
}

export interface TrafficProvider {
  readonly name: string;
  readonly rightsId: string;
  events(bbox: BBox): Promise<TrafficEvent[]>;
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
  tolls: TollProvider;
  traffic: TrafficProvider;
  cameras: CameraProvider;
  imagery: ImageryProvider;
}

export class ProviderNotImplementedError extends HttpError {
  constructor(provider: string, phase: string) {
    super(501, 'NOT_IMPLEMENTED', `${provider} live integration lands in ${phase}; use the mock provider until then`);
  }
}

/** An upstream provider failed or was unreachable. Surfaced as 502 (or 404) with a safe message. */
export class UpstreamError extends HttpError {
  constructor(
    provider: string,
    status: 502 | 404 = 502,
    readonly detail?: string,
  ) {
    super(status, status === 404 ? 'NOT_FOUND' : 'UPSTREAM_UNAVAILABLE', status === 404 ? `${provider}: not found` : `${provider} unavailable`);
  }
}
