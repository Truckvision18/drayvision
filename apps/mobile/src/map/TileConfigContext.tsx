import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { MAPTILER_ATTRIBUTION, OSM_ATTRIBUTION, TileConfigSchema, type TileConfig } from '@drayvision/shared';
import { OfflineManager, TransformRequestManager } from '@maplibre/maplibre-react-native';
import { api as defaultApi, type ApiClient, type MapApi } from '../api/client';
import { config as appConfig } from '../config';
import type { KeyValueStore } from '../profiles/ProfileContext';

/**
 * The base-map configuration comes from OUR API (`GET /tiles/config`), not from the app build:
 * tile source, style URL, attribution, device-cache size, prefetch and export policy. Flipping
 * the server's tile-source flag therefore takes effect on the next launch / foreground — no
 * app release. The last good config is kept on the device for offline starts.
 */
const CONFIG_KEY = 'drayvision.tileconfig.v1';
const DEVICE_KEY = 'drayvision.device-id.v1';

/** Used only before the first /tiles/config ever arrives. Attribution is the superset, never less. */
export function fallbackTileConfig(styleUrl: string): TileConfig {
  return TileConfigSchema.parse({
    config_version: 'fallback',
    source: 'maptiler',
    delivery: 'proxy',
    style_url: styleUrl,
    layer_anchors: true,
    attribution: [MAPTILER_ATTRIBUTION, OSM_ATTRIBUTION],
    billing_unit: 'request',
    device_cache: { ambient_cache_bytes: 64 * 1024 * 1024 },
    prefetch: { enabled: false, corridor_buffer_m: 500, corridor_chunk_m: 1000, destination_radius_m: 1500, min_zoom: 10, max_zoom: 16, max_tiles_per_pack: 2000, max_packs: 80 },
    export: { snapshot_allowed: false },
    session: { max_duration_s: 21_600, max_requests: 10_000 },
  });
}

/** RFC 4122 v4 id without native crypto (Hermes has no crypto.randomUUID). Analytics only. */
export function randomId(): string {
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface TileConfigValue {
  tileConfig: TileConfig;
  deviceId: string | null;
  /** True once a config from the server (or device cache) is in use. */
  ready: boolean;
  refresh(): Promise<void>;
}

const Ctx = createContext<TileConfigValue | null>(null);

export function useTileConfig(): TileConfigValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTileConfig must be used inside <TileConfigProvider>');
  return v;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function TileConfigProvider({
  children,
  api = defaultApi,
  store,
}: {
  children: React.ReactNode;
  api?: MapApi & Partial<Pick<ApiClient, 'setDeviceId' | 'baseUrl' | 'styleUrl'>>;
  store: KeyValueStore;
}) {
  const [tileConfig, setTileConfig] = useState<TileConfig>(() => fallbackTileConfig(api.styleUrl ?? defaultApi.styleUrl));
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const refresh = useMemo(
    () => async () => {
      try {
        const fresh = await api.tileConfig();
        setTileConfig((cur) => (cur.config_version === fresh.config_version ? cur : fresh));
        setReady(true);
        await store.setItem(CONFIG_KEY, JSON.stringify(fresh)).catch(() => undefined);
      } catch {
        // offline: keep the cached / current config
      }
    },
    [api, store],
  );

  // Device id (stable per install) + cached config, then a fresh fetch.
  useEffect(() => {
    let live = true;
    void (async () => {
      let id = await store.getItem(DEVICE_KEY).catch(() => null);
      if (!id) {
        id = randomId();
        await store.setItem(DEVICE_KEY, id).catch(() => undefined);
      }
      if (!live) return;
      api.setDeviceId?.(id);
      setDeviceId(id);
      const cached = TileConfigSchema.safeParse(JSON.parse((await store.getItem(CONFIG_KEY).catch(() => null)) ?? 'null'));
      if (live && cached.success) {
        setTileConfig(cached.data);
        setReady(true);
      }
      await refresh();
    })();
    return () => {
      live = false;
    };
  }, [api, store, refresh]);

  // Pick up a server-side flag flip on every foreground and periodically.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    const timer = setInterval(() => void refresh(), appConfig.refresh.tileConfigSeconds * 1000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  // Native side effects of the config.
  useEffect(() => {
    // Single-user, on-device ambient tile cache for the working area (allowed by MapTiler terms).
    void OfflineManager.setMaximumAmbientCacheSize(tileConfig.device_cache.ambient_cache_bytes).catch(() => undefined);
  }, [tileConfig.device_cache.ambient_cache_bytes]);

  useEffect(() => {
    // Attribute tile requests to this device: MapLibre's own requests to OUR API carry the
    // device id, so the proxy can count requests per user per day. Never sent to a third party.
    const base = api.baseUrl;
    if (!deviceId || !base) return;
    try {
      TransformRequestManager.addHeader({ id: 'dv-device', match: new RegExp(`^${escapeRe(base)}`), name: 'x-device-id', value: deviceId });
    } catch {
      // not available (e.g. tests) — request counts fall back to "unknown" device
    }
    return () => {
      try {
        TransformRequestManager.removeHeader('dv-device');
      } catch {
        /* ignore */
      }
    };
  }, [api.baseUrl, deviceId]);

  return <Ctx.Provider value={{ tileConfig, deviceId, ready, refresh }}>{children}</Ctx.Provider>;
}
