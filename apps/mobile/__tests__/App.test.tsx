import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { GeolocationPosition } from '@maplibre/maplibre-react-native';
import type { RoutingApi } from '../src/api/client';
import App from '../src/App';
import type { LocationSource } from '../src/location/LocationContext';
import { lRoute, north } from './fixtures';

/** A controllable GPS: tests push positions through it. */
function fakeGps(granted = true) {
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
  let t = 0;
  const push = (lng: number, lat: number, speed = 10) =>
    act(() => {
      t += 1000;
      listener?.({ coords: { longitude: lng, latitude: lat, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed }, timestamp: t });
    });
  return { source, push };
}

const longPress = (lng: number, lat: number) =>
  fireEvent(screen.getByTestId('map-view'), 'longPress', { nativeEvent: { lngLat: [lng, lat], point: [0, 0] } });

describe('App', () => {
  it('launches to an empty map on the Plan screen, styled via our API tile proxy', async () => {
    render(<App locationSource={fakeGps().source} />);
    await waitFor(() => expect(screen.getByTestId('plan-screen')).toBeTruthy());
    const map = screen.getByTestId('map-view');
    expect(map.props.mapStyle).toMatch(/\/tiles\/style\.json$/);
    expect(map.props.mapStyle).not.toMatch(/maptiler|key=/i);
    expect(screen.getByText('Long-press the map to set a destination')).toBeTruthy();
  });

  it('switches between the five screens', async () => {
    render(<App locationSource={fakeGps().source} />);
    await waitFor(() => screen.getByTestId('plan-screen'));
    for (const [tab, id] of [
      ['navigate', 'screen-Navigate'],
      ['kbyg', 'screen-KnowBeforeYouGo'],
      ['facilities', 'screen-Facilities'],
      ['settings', 'screen-Settings'],
      ['plan', 'plan-screen'],
    ] as const) {
      fireEvent.press(screen.getByTestId(`tab-${tab}`));
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('plans from the GPS fix, previews, starts, guides turn-by-turn and arrives', async () => {
    const gps = fakeGps();
    const api: RoutingApi = { route: jest.fn(async () => ({ routes: [lRoute()] })) };
    render(<App locationSource={gps.source} api={api} />);
    await waitFor(() => screen.getByTestId('plan-screen'));
    await gps.push(0, 0);

    longPress(0.01, 0.01);
    fireEvent.press(screen.getByTestId('find-route'));
    await waitFor(() => screen.getByTestId('route-card-r1'));
    expect(api.route).toHaveBeenCalledWith({ lng: 0, lat: 0 }, { lng: 0.01, lat: 0.01 }, expect.objectContaining({ heightM: 4.11 }));

    fireEvent.press(screen.getByTestId('start-nav'));
    await waitFor(() => screen.getByTestId('maneuver-banner')); // auto-switched to Navigate

    await gps.push(0, north(600));
    expect(screen.getByText('Turn right onto Port St.')).toBeTruthy();
    expect(screen.getByText('0.3 mi')).toBeTruthy(); // ~512 m to the turn

    await gps.push(0.005, 0.01);
    expect(screen.getByText('Arrive.')).toBeTruthy();

    await gps.push(0.01, 0.01);
    expect(screen.getByTestId('arrived-banner')).toBeTruthy();
    fireEvent.press(screen.getByTestId('end-trip'));
    expect(screen.getByText('No active trip — plan one on the Plan tab.')).toBeTruthy();
  });

  it('reroutes from the current position when the driver leaves the route', async () => {
    {
      const gps = fakeGps();
      const route = jest.fn(async () => ({ routes: [lRoute()] }));
      render(<App locationSource={gps.source} api={{ route }} />);
      await waitFor(() => screen.getByTestId('plan-screen'));
      await gps.push(0, 0);
      longPress(0.01, 0.01);
      fireEvent.press(screen.getByTestId('find-route'));
      await waitFor(() => screen.getByTestId('start-nav'));
      fireEvent.press(screen.getByTestId('start-nav'));
      await waitFor(() => screen.getByTestId('maneuver-banner'));

      for (let i = 0; i < 6; i++) await gps.push(0.002, north(300)); // ~220 m off route, for > confirm window
      // First reroute is immediate (the rate limit only spaces out repeats); the fake API answers
      // instantly, so the "rerouting" banner may already be gone — assert on the request instead.
      await waitFor(() => expect(route).toHaveBeenCalledTimes(2));
      expect(route).toHaveBeenLastCalledWith({ lng: 0.002, lat: north(300) }, { lng: 0.01, lat: 0.01 }, expect.anything());
      await waitFor(() => screen.getByTestId('maneuver-banner'));
    }
  });

  it('shows a rerouting banner while the new route is on its way', async () => {
    const gps = fakeGps();
    const route = jest
      .fn<ReturnType<RoutingApi['route']>, Parameters<RoutingApi['route']>>()
      .mockResolvedValueOnce({ routes: [lRoute()] })
      .mockReturnValue(new Promise(() => undefined)); // reroute never answers
    render(<App locationSource={gps.source} api={{ route }} />);
    await waitFor(() => screen.getByTestId('plan-screen'));
    await gps.push(0, 0);
    longPress(0.01, 0.01);
    fireEvent.press(screen.getByTestId('find-route'));
    await waitFor(() => screen.getByTestId('start-nav'));
    fireEvent.press(screen.getByTestId('start-nav'));
    for (let i = 0; i < 6; i++) await gps.push(0.002, north(300));
    await waitFor(() => screen.getByTestId('rerouting-banner'));
    expect(screen.queryByTestId('maneuver-banner')).toBeNull();
  });

  it('shows the server reason when no truck-safe route exists', async () => {
    const gps = fakeGps();
    const api: RoutingApi = { route: jest.fn(async () => Promise.reject(new Error('No truck-legal route found: No path could be found for input'))) };
    render(<App locationSource={gps.source} api={api} />);
    await waitFor(() => screen.getByTestId('plan-screen'));
    await gps.push(0, 0);
    longPress(0.01, 0.01);
    fireEvent.press(screen.getByTestId('find-route'));
    await waitFor(() => screen.getByTestId('plan-error'));
    expect(screen.getByText(/No truck-legal route found/)).toBeTruthy();
  });

  it('asks for a GPS fix before planning', async () => {
    render(<App locationSource={fakeGps().source} api={{ route: jest.fn() }} />);
    await waitFor(() => screen.getByTestId('plan-screen'));
    longPress(0.01, 0.01);
    fireEvent.press(screen.getByTestId('find-route'));
    expect(screen.getByText(/Waiting for a GPS fix/)).toBeTruthy();
  });

  it('explains when location permission is denied', async () => {
    render(<App locationSource={fakeGps(false).source} />);
    await waitFor(() => screen.getByText(/Location permission is off/));
  });
});
