import React, { createContext, useContext } from 'react';
import { isAllowed, type GatedFeature, type MotionState } from './motionGate';

const MotionContext = createContext<MotionState>('unknown');

export const MotionProvider = MotionContext.Provider;

export function useMotionState(): MotionState {
  return useContext(MotionContext);
}

/** Renders children only when parked; otherwise a fallback telling the driver why. */
export function ParkedOnly({ feature, children, fallback }: { feature: GatedFeature; children: React.ReactNode; fallback: React.ReactNode }) {
  const state = useMotionState();
  return <>{isAllowed(feature, state) ? children : fallback}</>;
}
