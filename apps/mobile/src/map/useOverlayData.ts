import { useEffect, useRef, useState } from 'react';
import type { Camera, Facility, Hazard, SponsoredListing, TrafficEvent } from '@drayvision/shared';
import type { BBox, MapApi } from '../api/client';
import { config } from '../config';
import type { LayerToggles } from './MapLayersContext';

export interface FetchedOverlays {
  restrictions: Hazard[];
  traffic: TrafficEvent[];
  cameras: Camera[];
  facilities: Facility[];
  sponsored: SponsoredListing[];
}

const empty: FetchedOverlays = { restrictions: [], traffic: [], cameras: [], facilities: [], sponsored: [] };

type Key = keyof FetchedOverlays;
const LAYER_OF: Record<Key, keyof LayerToggles> = { restrictions: 'hazards', traffic: 'traffic', cameras: 'cameras', facilities: 'facilities', sponsored: 'sponsored' };
const REFRESH_S: Record<Key, number> = {
  restrictions: config.refresh.restrictionsSeconds,
  traffic: config.refresh.trafficSeconds,
  cameras: config.refresh.camerasSeconds,
  facilities: config.refresh.facilitiesSeconds,
  sponsored: config.refresh.sponsoredSeconds,
};

/**
 * Fetch overlay data for the visible map area — only for layers that are actually shown
 * (cameras are metered upstream and parked-only, so they're never fetched while moving).
 * Debounced on pan/zoom, refreshed on each layer's own interval from config.
 */
export function useOverlayData(api: Pick<MapApi, 'restrictions' | 'traffic' | 'cameras' | 'facilities' | 'sponsored'>, bbox: BBox | null, visible: LayerToggles): FetchedOverlays {
  const [data, setData] = useState<FetchedOverlays>(empty);
  const apiRef = useRef(api);
  apiRef.current = api;
  const key = bbox?.join(',') ?? '';

  useEffect(() => {
    if (!bbox) return;
    let live = true;
    const timers: ReturnType<typeof setInterval>[] = [];
    const load = (k: Key) => {
      const call = apiRef.current[k] as (b: BBox) => Promise<FetchedOverlays[Key]>;
      void call(bbox).then(
        (v) => live && setData((d) => ({ ...d, [k]: v })),
        () => undefined, // keep what we had; overlays are best-effort
      );
    };
    const debounce = setTimeout(() => {
      for (const k of Object.keys(LAYER_OF) as Key[]) {
        if (!visible[LAYER_OF[k]]) continue;
        load(k);
        timers.push(setInterval(() => load(k), REFRESH_S[k] * 1000));
      }
    }, config.map.overlayFetchDebounceMs);
    // Drop data for layers that are off (e.g. cameras the moment the truck moves).
    setData((d) => {
      const next = { ...d };
      for (const k of Object.keys(LAYER_OF) as Key[]) if (!visible[LAYER_OF[k]]) next[k] = [] as never;
      return next;
    });
    return () => {
      live = false;
      clearTimeout(debounce);
      timers.forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible.hazards, visible.traffic, visible.cameras, visible.facilities, visible.sponsored]);

  return data;
}
