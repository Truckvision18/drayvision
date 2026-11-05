import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { LocationManager, type GeolocationPosition } from '@maplibre/maplibre-react-native';
import { config } from '../config';
import type { Fix } from '../navigation/progress';
import { checkStale, initialGate, reduceMotion, type GateState, type MotionState } from '../safety/motionGate';
import { MotionProvider } from '../safety/MotionGateContext';

export type LocationPermission = 'unknown' | 'granted' | 'denied';

export interface LocationValue {
  fix: Fix | null;
  permission: LocationPermission;
  motion: MotionState;
}

const LocationCtx = createContext<LocationValue>({ fix: null, permission: 'unknown', motion: 'unknown' });

export const useLocation = (): LocationValue => useContext(LocationCtx);

/** Something that delivers GPS positions. Defaults to MapLibre's LocationManager; tests inject fakes. */
export interface LocationSource {
  requestPermissions(): Promise<boolean>;
  addListener(fn: (p: GeolocationPosition) => void): void;
  removeListener(fn: (p: GeolocationPosition) => void): void;
}

export const toFix = (p: GeolocationPosition): Fix => ({
  location: { lng: p.coords.longitude, lat: p.coords.latitude },
  accuracyM: p.coords.accuracy,
  timestamp: p.timestamp,
});

/**
 * One GPS subscription for the whole app. Feeds both turn-by-turn (via `useLocation().fix`) and
 * the parked/moving safety gate (via MotionProvider), so they can never disagree about position.
 */
export function LocationProvider({ children, source = LocationManager }: { children: React.ReactNode; source?: LocationSource }) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [gate, setGate] = useState<GateState>(initialGate);
  const gateRef = useRef(gate);
  gateRef.current = gate;

  useEffect(() => {
    let cancelled = false;
    const onPosition = (p: GeolocationPosition): void => {
      setFix(toFix(p));
      setGate((g) => reduceMotion(g, { speedMps: p.coords.speed, accuracyM: p.coords.accuracy, timestamp: p.timestamp }, config.safety));
    };
    source
      .requestPermissions()
      .then((ok) => {
        if (cancelled) return;
        setPermission(ok ? 'granted' : 'denied');
        if (ok) source.addListener(onPosition);
      })
      .catch(() => !cancelled && setPermission('denied'));
    // No fresh fixes → fall back to "unknown" (treated as moving) so gated UI locks again.
    const stale = setInterval(() => setGate((g) => checkStale(g, Date.now(), config.safety)), 1000);
    return () => {
      cancelled = true;
      clearInterval(stale);
      source.removeListener(onPosition);
    };
  }, [source]);

  return (
    <LocationCtx.Provider value={{ fix, permission, motion: gate.state }}>
      <MotionProvider value={gate.state}>{children}</MotionProvider>
    </LocationCtx.Provider>
  );
}
