import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../src/App';
import { fakeApi, memoryStore } from './fakeApi';
import { north, profile } from './fixtures';
import { boot, fakeGps, longPress, planTo } from './harness';

describe('App', () => {
  it('launches to an empty map on the Plan screen, styled via our API tile proxy', async () => {
    await boot();
    const map = screen.getByTestId('map-view');
    // Style from the server's tile config (source-namespaced proxy URL), never the provider directly.
    await waitFor(() => expect(map.props.mapStyle).toBe('http://api.test/tiles/maptiler/style.json'));
    expect(map.props.mapStyle).not.toMatch(/api\.maptiler\.com|key=/i);
    expect(await screen.findByText('Long-press the map to set a destination')).toBeTruthy();
    expect(screen.getByText('Routing as: Volvo + 40ft chassis')).toBeTruthy();
  });

  it('switches between the five screens', async () => {
    await boot();
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

  it('plans for the active profile, previews, starts, guides turn-by-turn and arrives', async () => {
    const { gps, server } = await boot();
    await planTo(gps);
    await waitFor(() => screen.getByTestId('route-card-route-1'));
    expect(server.route).toHaveBeenCalledWith(
      expect.objectContaining({ origin: { lng: 0, lat: 0 }, destination_coords: { lng: 0.01, lat: 0.01 }, truck_profile_id: 'truck-1', departure_time: expect.any(String) }),
    );

    fireEvent.press(screen.getByTestId('start-nav'));
    await waitFor(() => screen.getByTestId('maneuver-banner'));
    expect(screen.getByTestId('route-versions').props.children.join('')).toMatch(/truck v1/);

    await gps.push(0, north(600));
    expect(screen.getByText('Turn right onto Port St.')).toBeTruthy();
    expect(screen.getByText('0.3 mi')).toBeTruthy();
    await gps.push(0.005, 0.01);
    expect(screen.getByText('Arrive.')).toBeTruthy();
    await gps.push(0.01, 0.01);
    expect(screen.getByTestId('arrived-banner')).toBeTruthy();
    fireEvent.press(screen.getByTestId('end-trip'));
    expect(screen.getByText('No active trip — plan one on the Plan tab.')).toBeTruthy();
  });

  it('reroutes from the current position when the driver leaves the route', async () => {
    const { gps, server } = await boot();
    await planTo(gps);
    fireEvent.press(await screen.findByTestId('start-nav'));
    await waitFor(() => screen.getByTestId('maneuver-banner'));
    for (let i = 0; i < 6; i++) await gps.push(0.002, north(300));
    await waitFor(() => expect(server.route).toHaveBeenCalledTimes(2));
    expect(server.route).toHaveBeenLastCalledWith(expect.objectContaining({ origin: { lng: 0.002, lat: north(300) }, truck_profile_id: 'truck-1' }));
    await waitFor(() => screen.getByTestId('maneuver-banner'));
  });

  it('asks for a GPS fix before planning', async () => {
    const { server } = await boot();
    longPress(0.01, 0.01);
    fireEvent.press(await screen.findByTestId('find-route'));
    expect(screen.getByText(/Waiting for a GPS fix/)).toBeTruthy();
    expect(server.route).not.toHaveBeenCalled();
  });

  it('explains when location permission is denied', async () => {
    await boot({ granted: false });
    await waitFor(() => screen.getByText(/Location permission is off/));
  });
});

describe('truck profile rules in the app', () => {
  it('with NO profile, routing is blocked behind "Add truck profile" — no default rig is used', async () => {
    const { gps, server } = await boot({ profiles: [] });
    await gps.push(0, 0);
    longPress(0.01, 0.01);
    expect(await screen.findByTestId('complete-profile')).toBeTruthy();
    expect(screen.queryByTestId('find-route')).toBeNull();
    expect(screen.getByText('No truck profile')).toBeTruthy();
    expect(server.route).not.toHaveBeenCalled();
  });

  it('an INCOMPLETE profile blocks routing with the "complete your truck profile" message', async () => {
    const { gps, server } = await boot({ profiles: [profile({ height_m: null, weight_kg: null })] });
    await gps.push(0, 0);
    longPress(0.01, 0.01);
    expect(await screen.findByText('Complete your truck profile: add height and weight before DrayVision can plan a route.')).toBeTruthy();
    expect(screen.queryByTestId('find-route')).toBeNull();
    fireEvent.press(screen.getByTestId('complete-profile-button'));
    expect(screen.getByTestId('incomplete-truck-1')).toBeTruthy();
    expect(server.route).not.toHaveBeenCalled();
  });

  it('completing the profile in the editor (while parked) unblocks routing at the new version', async () => {
    const { gps, server } = await boot({ profiles: [profile({ height_m: null, weight_kg: null })] });
    await gps.park();
    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(screen.getByTestId('edit-truck-1'));
    fireEvent.changeText(screen.getByTestId('field-height-ft'), '13');
    fireEvent.changeText(screen.getByTestId('field-height-in'), '6');
    fireEvent.changeText(screen.getByTestId('field-weight'), '80000');
    fireEvent.press(screen.getByTestId('save-profile'));
    await waitFor(() => expect(server.api.updateProfile).toHaveBeenCalled());
    expect(server.api.updateProfile).toHaveBeenCalledWith('truck-1', {
      expected_version: 1,
      height_m: expect.closeTo(4.1148, 4),
      weight_kg: expect.closeTo(36287.39, 1),
    });
    await waitFor(() => screen.getByTestId('screen-Settings'));
    expect(screen.queryByTestId('incomplete-truck-1')).toBeNull();

    fireEvent.press(screen.getByTestId('tab-plan'));
    await planTo(gps);
    await waitFor(() => screen.getByTestId('route-card-route-1'));
    expect(server.route).toHaveBeenCalledWith(expect.objectContaining({ truck_profile_id: 'truck-1' }));
  });

  it('the editor is locked while the truck is not confirmed parked', async () => {
    await boot();
    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(screen.getByTestId('edit-truck-1'));
    expect(screen.getByTestId('editor-locked')).toBeTruthy();
    expect(screen.queryByTestId('field-height-ft')).toBeNull();
  });

  it('device cache: a repeat plan is served locally, but an EDIT invalidates it and replans at the new version', async () => {
    const { gps, server } = await boot();
    await planTo(gps);
    await waitFor(() => screen.getByTestId('route-card-route-1'));
    fireEvent.press(screen.getByText('Cancel'));
    await planTo(gps);
    await waitFor(() => screen.getByTestId('route-card-route-1'));
    expect(server.route).toHaveBeenCalledTimes(1); // served from the device cache

    // Edit the truck (parked) → version 2.
    await gps.park();
    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(screen.getByTestId('edit-truck-1'));
    fireEvent.changeText(screen.getByTestId('field-height-in'), '11');
    fireEvent.press(screen.getByTestId('save-profile'));
    await waitFor(() => screen.getByTestId('screen-Settings'));

    fireEvent.press(screen.getByTestId('tab-plan'));
    // The preview that was open was for v1 → it is replanned automatically for v2.
    await waitFor(() => expect(server.route).toHaveBeenCalledTimes(2));
    expect(server.current()[0]!.version).toBe(2);
    await waitFor(() => screen.getByTestId('route-card-route-2'));
  });

  it('an edit made on another device, picked up on sync, voids the cached route too', async () => {
    const store = memoryStore();
    const first = await boot({ store });
    await planTo(first.gps);
    await waitFor(() => screen.getByTestId('route-card-route-1'));
    // Wait for persistence, then "restart" the app with the server now at v2.
    await waitFor(() => expect((JSON.parse(store.data.get('drayvision.device.v1') ?? '{"routes":[]}') as { routes: unknown[] }).routes).toHaveLength(1));
    screen.unmount();

    const server2 = fakeApi([profile({ version: 2, height_m: 4.27 })]);
    const gps2 = fakeGps();
    render(<App locationSource={gps2.source} api={server2.api} store={store} />);
    await waitFor(() => expect(server2.api.listProfiles).toHaveBeenCalled());
    await planTo(gps2);
    await waitFor(() => expect(server2.route).toHaveBeenCalledTimes(1)); // not served from the stale cache
  });

  it('offline: profiles cached on the device still drive routing decisions', async () => {
    const store = memoryStore();
    await boot({ store, profiles: [profile({ weight_kg: null })] });
    await waitFor(() => expect(store.data.get('drayvision.device.v1')).toContain('"weight_kg":null'));
    screen.unmount();

    const server = fakeApi([]);
    (server.api.listProfiles as jest.Mock).mockRejectedValue(new Error('offline'));
    render(<App locationSource={fakeGps().source} api={server.api} store={store} />);
    expect(await screen.findByText(/Complete your truck profile: add weight/)).toBeTruthy();
  });

  it('a stale edit (another device saved first) is refused with a clear message, not overwritten', async () => {
    const { gps, server } = await boot();
    await gps.park();
    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(screen.getByTestId('edit-truck-1'));
    server.editElsewhere('truck-1', { axle_count: 6 });
    fireEvent.changeText(screen.getByTestId('field-axles'), '4');
    fireEvent.press(screen.getByTestId('save-profile'));
    expect(await screen.findByTestId('save-error')).toHaveTextContent(/changed on another device/);
    expect(server.current()[0]).toMatchObject({ version: 2, axle_count: 6 });
  });

  it('switching the routing truck replans an open preview for that truck', async () => {
    const { gps, server } = await boot({ profiles: [profile(), profile({ id: 'truck-2', name: 'Day cab', is_default: false, height_m: 3.9 })] });
    await planTo(gps);
    await waitFor(() => screen.getByTestId('route-card-route-1'));
    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(screen.getByTestId('activate-truck-2'));
    fireEvent.press(screen.getByTestId('tab-plan'));
    await waitFor(() => expect(server.route).toHaveBeenCalledTimes(2));
    expect(server.route).toHaveBeenLastCalledWith(expect.objectContaining({ truck_profile_id: 'truck-2' }));
    expect(screen.getByText('Routing as: Day cab')).toBeTruthy();
  });
});
