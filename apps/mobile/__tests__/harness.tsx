import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { GeolocationPosition } from '@maplibre/maplibre-react-native';
import App from '../src/App';
import type { LocationSource } from '../src/location/LocationContext';
import { fakeApi, memoryStore } from './fakeApi';
import { profile } from './fixtures';

/** A controllable GPS: tests push positions through it. Timestamps track real time so nothing goes stale. */
export function fakeGps(granted = true) {
  let listener: ((p: GeolocationPosition) => void) | null = null;
  const source: LocationSource = {
    requestPermissions: async () => granted,
    addListener: (fn) => {
      listener = fn;
    },
    removeListener: () => {
      listener = null;
    },
  };
  let t = Date.now();
  const push = (lng: number, lat: number, speed = 10) =>
    act(() => {
      t += 1000;
      listener?.({ coords: { longitude: lng, latitude: lat, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed }, timestamp: t });
    });
  /** Sit still long enough for the motion gate to report PARKED. */
  const park = async (lng = 0, lat = 0) => {
    for (let i = 0; i < 12; i++) await push(lng, lat, 0);
  };
  return { source, push, park };
}

export const longPress = (lng: number, lat: number) => fireEvent(screen.getByTestId('map-view'), 'longPress', { nativeEvent: { lngLat: [lng, lat], point: [0, 0] } });

export async function boot(opts: { profiles?: ReturnType<typeof profile>[]; granted?: boolean; store?: ReturnType<typeof memoryStore> } = {}) {
  const gps = fakeGps(opts.granted ?? true);
  const server = fakeApi(opts.profiles ?? [profile()]);
  const store = opts.store ?? memoryStore();
  render(<App locationSource={gps.source} api={server.api} store={store} />);
  await waitFor(() => screen.getByTestId('plan-screen'));
  await waitFor(() => expect(server.api.listProfiles).toHaveBeenCalled());
  return { gps, server, store };
}

export async function planTo(gps: ReturnType<typeof fakeGps>, lng = 0.01, lat = 0.01) {
  await gps.push(0, 0);
  longPress(lng, lat);
  const button = await screen.findByTestId('find-route');
  // Async act: the API reply and the device-cache write both settle inside React's act scope.
  await act(async () => {
    fireEvent.press(button);
  });
}

