import { useEffect, useRef } from 'react';
import type { MapSessionStart, MapViewKind } from '@drayvision/shared';
import type { MapApi } from '../api/client';
import { randomId, useTileConfig } from './TileConfigContext';

/** Local, per-app-run tally — shown next to the server's numbers in the debug panel. */
export const localSessionCounter = { started: 0 };

/**
 * One map session per map mount, rotated after the configured max duration (MapTiler's own
 * definition: a session ends after 6 h or 10,000 requests; the request cap is enforced
 * server-side from proxy counts). Reported to OUR analytics; MapTiler itself bills this
 * integration per request, so sessions here are for per-user-per-day analytics.
 */
export function useMapSession(view: MapViewKind, api: Pick<MapApi, 'reportMapSession'>): void {
  const { tileConfig, deviceId } = useTileConfig();
  const maxMs = tileConfig.session.max_duration_s * 1000;
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    if (!deviceId) return; // wait until requests can be attributed to this install
    const start = (): void => {
      const s: MapSessionStart = { session_id: randomId(), view, started_at: new Date().toISOString() };
      localSessionCounter.started += 1;
      void apiRef.current.reportMapSession(s).catch(() => undefined); // analytics must never break the map
    };
    start();
    const timer = setInterval(start, maxMs);
    return () => clearInterval(timer);
  }, [view, deviceId, maxMs]);
}
