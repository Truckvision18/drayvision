import React, { createContext, useContext, useState } from 'react';
import type { ToggleableLayer } from '@drayvision/shared';
import { config } from '../config';
import { useLocation } from '../location/LocationContext';
import { isAllowed } from '../safety/motionGate';

export type LayerToggles = Record<ToggleableLayer, boolean>;

interface MapLayersValue {
  /** What the driver switched on. */
  toggles: LayerToggles;
  setLayer(layer: ToggleableLayer, on: boolean): void;
  /** What is actually drawn: toggles minus anything the motion gate forbids right now. */
  visible: LayerToggles;
  /** Layers that exist but can't be shown right now, with why. */
  blocked: Partial<Record<ToggleableLayer, string>>;
}

const Ctx = createContext<MapLayersValue | null>(null);

export function useMapLayers(): MapLayersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMapLayers must be used inside <MapLayersProvider>');
  return v;
}

/** One set of layer toggles for every map in the app (plan, navigate, facility). */
export function MapLayersProvider({ children }: { children: React.ReactNode }) {
  const [toggles, setToggles] = useState<LayerToggles>({ ...config.map.defaultLayers });
  const { motion } = useLocation();
  // Cameras (Phase 8) are a parked-only view — camera stills distract a moving driver.
  const camerasAllowed = isAllowed('camera-stills', motion);
  const blocked: MapLayersValue['blocked'] = camerasAllowed ? {} : { cameras: 'Parked only' };
  const visible: LayerToggles = { ...toggles, cameras: toggles.cameras && camerasAllowed };
  return (
    <Ctx.Provider value={{ toggles, visible, blocked, setLayer: (layer, on) => setToggles((t) => ({ ...t, [layer]: on })) }}>{children}</Ctx.Provider>
  );
}
