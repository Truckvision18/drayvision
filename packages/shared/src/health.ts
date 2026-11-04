export interface DataVersions {
  /** OSM extract date the Valhalla graph was built from, or "not-built". */
  routingGraph: string;
  restrictions: string;
  facilities: string;
  rightsRegistry: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'drayvision-api';
  version: string;
  gitSha: string;
  environment: string;
  dataVersions: DataVersions;
  dependencies: Record<string, 'up' | 'down' | 'not-configured'>;
  time: string;
}
