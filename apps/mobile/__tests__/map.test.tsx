import React from 'react';
import { AppState, Dimensions, Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { layerAnchorId, MAP_LAYER_ORDER, OSM_ATTRIBUTION, type MapLayerId } from '@drayvision/shared';
import { OfflineManager, TransformRequestManager } from '@maplibre/maplibre-react-native';
import App from '../src/App';
import { attributionItems } from '../src/map/MapAttribution';
import { LAYER_SPECS } from '../src/map/overlays';
import { buildShareMessage, shareRoute } from '../src/map/share';
import { fakeApi, memoryStore, tileConfigFixture } from './fakeApi';
import { lRoute, profile } from './fixtures';
import { boot, fakeGps, planTo } from './harness';

const ATTR_MAPTILER = '© MapTiler';
const ATTR_OSM = '© OpenStreetMap contributors';

/** Text of every attribution overlay currently rendered. */
const attributionTexts = (): string[][] =>
  screen.getAllByTestId('map-attribution').map((el) => within(el).queryAllByText(/©/).map((t) => String(t.props.children)));

async function startTrip(gps: ReturnType<typeof fakeGps>) {
  await planTo(gps);
  fireEvent.press(await screen.findByTestId('start-nav'));
  await waitFor(() => screen.getByTestId('maneuver-banner'));
}

describe('attribution (automated UI test — fails if attribution is missing)', () => {
  it('every map instance (plan, navigate, facility) shows MapTiler + OSM attribution', async () => {
    const { gps } = await boot();
    await waitFor(() => expect(screen.getByTestId('map-view').props.mapStyle).toContain('/tiles/maptiler/'));

    const check = () => {
      const maps = screen.getAllByTestId('map-view');
      const attrs = attributionTexts();
      expect(attrs).toHaveLength(maps.length); // one per map, no map without one
      for (const a of attrs) expect(a).toEqual([ATTR_MAPTILER, ATTR_OSM]);
    };

    check(); // plan view
    fireEvent.press(screen.getByTestId('tab-facilities'));
    expect(screen.getByTestId('map-facility')).toBeTruthy();
    check(); // facility view
    fireEvent.press(screen.getByTestId('tab-plan'));
    await startTrip(gps);
    expect(screen.getByTestId('map-navigate')).toBeTruthy();
    check(); // navigation view
  });

  it('attribution links go to the copyright pages', async () => {
    await boot();
    await waitFor(() => expect(attributionTexts()[0]).toEqual([ATTR_MAPTILER, ATTR_OSM]));
    const links = within(screen.getByTestId('map-attribution')).getAllByRole('link');
    expect(links).toHaveLength(2);
  });

  it('OSM attribution can never be dropped, even by a bad config', () => {
    expect(attributionItems([])).toEqual([OSM_ATTRIBUTION]);
    expect(attributionItems([{ text: '© MapTiler', url: 'https://www.maptiler.com/copyright/' }]).map((a) => a.text)).toEqual([ATTR_MAPTILER, ATTR_OSM]);
  });

  it('shared / exported views carry the attribution; MapTiler never as a map image', async () => {
    const share = { share: jest.fn(async () => ({ action: 'sharedAction' }) as never) };
    const snap = { createStaticMapImage: jest.fn(async () => 'file:///snap.png') };
    const route = lRoute();
    await shareRoute(route, tileConfigFixture('maptiler'), snap, share);
    expect(share.share).toHaveBeenLastCalledWith({ message: expect.stringContaining(`Map data: ${ATTR_MAPTILER} ${ATTR_OSM}`) });
    expect(snap.createStaticMapImage).not.toHaveBeenCalled(); // MapTiler Cloud Terms §7
    await shareRoute(route, tileConfigFixture('self-hosted'), snap, share);
    expect(share.share).toHaveBeenLastCalledWith({ message: expect.stringContaining(`Map data: ${ATTR_OSM}`), url: 'file:///snap.png' });
    expect(buildShareMessage(route, tileConfigFixture('mock'))).toMatch(/OpenStreetMap/);
  });

  it('the Share button on a route preview shares with attribution', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const { gps } = await boot();
    await planTo(gps);
    fireEvent.press(await screen.findByTestId('share-route'));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0]).toEqual({ message: expect.stringContaining(ATTR_OSM) });
    spy.mockRestore();
  });
});

/** Rendered layer ids in tree order. */
const layerOrder = (): string[] => screen.getAllByTestId(/^layer-dv-/).map((l) => l.props.id as string);
const visibility = (layerId: string): string => screen.getByTestId(`layer-${layerId}`).props.layout.visibility;
const groupOf = (layerId: string): MapLayerId => MAP_LAYER_ORDER.find((g) => LAYER_SPECS[g].some((s) => s.id === layerId))!;

describe('layers: z-order and toggles', () => {
  it('stacks overlays base → route → hazards → traffic → cameras → facilities → sponsored, pinned below the next anchor', async () => {
    await boot();
    const order = layerOrder();
    expect(order.map(groupOf)).toEqual(MAP_LAYER_ORDER.flatMap((g) => LAYER_SPECS[g].map(() => g)));
    for (const id of order) {
      const g = groupOf(id);
      const next = MAP_LAYER_ORDER[MAP_LAYER_ORDER.indexOf(g) + 1] ?? 'top';
      expect(screen.getByTestId(`layer-${id}`).props.beforeId).toBe(layerAnchorId(next));
    }
  });

  it.each([
    ['small phone 320×568', { width: 320, height: 568 }],
    ['large phone 430×932', { width: 430, height: 932 }],
  ])('renders at %s with every layer toggle working', async (_n, size) => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({ ...size, scale: 2, fontScale: 1 });
    const { gps } = await boot();
    await gps.park(); // cameras are parked-only
    fireEvent.press(screen.getByTestId('layers-button'));
    expect(screen.getByTestId('layers-panel')).toBeTruthy();
    const cases: Array<[string, string]> = [
      ['hazards', 'dv-hazards'],
      ['traffic', 'dv-traffic'],
      ['cameras', 'dv-cameras'],
      ['facilities', 'dv-entrances'],
      ['sponsored', 'dv-sponsored-pin'],
    ];
    for (const [toggle, layer] of cases) {
      const before = visibility(layer);
      fireEvent(screen.getByTestId(`toggle-${toggle}`), 'valueChange', before !== 'visible');
      expect(visibility(layer)).toBe(before === 'visible' ? 'none' : 'visible');
      fireEvent(screen.getByTestId(`toggle-${toggle}`), 'valueChange', before === 'visible');
      expect(visibility(layer)).toBe(before);
    }
    // Every sub-layer of a group follows its toggle (e.g. sponsored pin AND its "Sponsored" label).
    fireEvent(screen.getByTestId('toggle-sponsored'), 'valueChange', false);
    expect(['dv-sponsored-pin', 'dv-sponsored-label'].map(visibility)).toEqual(['none', 'none']);
    (Dimensions.get as jest.Mock).mockRestore();
  });

  it('cameras only ever show while parked — and are not even fetched while moving', async () => {
    const { gps, server } = await boot();
    fireEvent.press(screen.getByTestId('layers-button'));
    fireEvent(screen.getByTestId('toggle-cameras'), 'valueChange', true);
    expect(screen.getByText('Parked only')).toBeTruthy();
    expect(visibility('dv-cameras')).toBe('none');
    fireEvent(screen.getByTestId('map-view'), 'regionDidChange', { nativeEvent: { bounds: [-74.2, 40.6, -74.0, 40.8] } });
    await act(async () => {
      await new Promise<void>((r) => setTimeout(() => r(), 700));
    });
    expect(server.api.cameras).not.toHaveBeenCalled();
    await gps.park();
    expect(visibility('dv-cameras')).toBe('visible');
  });

  it('fetches overlay data for the visible area, only for layers that are on', async () => {
    const { server } = await boot();
    fireEvent(screen.getByTestId('map-view'), 'regionDidChange', { nativeEvent: { bounds: [-74.2, 40.6, -74.0, 40.8] } });
    await waitFor(() => expect(server.api.restrictions).toHaveBeenCalledWith([-74.2, 40.6, -74.0, 40.8]));
    expect(server.api.traffic).toHaveBeenCalled();
    expect(server.api.facilities).toHaveBeenCalled();
    expect(server.api.sponsored).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('source-sponsored').props.data.features).toHaveLength(1));
    expect(screen.getByTestId('source-sponsored').props.data.features[0].properties.label).toBe('Sponsored');
    expect(screen.getByTestId('source-hazards').props.data.features[0].properties.id).toBe('bridge-9');
  });
});

describe('tile source: switching the server flag works without an app release', () => {
  it('a foreground after the flag flip swaps style + attribution on the running app', async () => {
    const { server } = await boot();
    await waitFor(() => expect(screen.getByTestId('map-view').props.mapStyle).toBe('http://api.test/tiles/maptiler/style.json'));
    server.setTileSource('self-hosted'); // ops flips TILE_SOURCE on the server
    const listeners = (AppState.addEventListener as unknown as jest.Mock | undefined)?.mock?.calls ?? [];
    await act(async () => {
      // Simulate the app coming to the foreground.
      for (const [event, fn] of listeners) if (event === 'change') (fn as (s: string) => void)('active');
      if (listeners.length === 0) AppState.currentState = 'active';
    });
    await waitFor(() => expect(screen.getByTestId('map-view').props.mapStyle).toBe('http://api.test/tiles/self-hosted/style.json'));
    expect(attributionTexts()[0]).toEqual([ATTR_OSM]);
  });

  it('starts from the last config cached on the device when the API is unreachable', async () => {
    const store = memoryStore({ 'drayvision.tileconfig.v1': JSON.stringify(tileConfigFixture('self-hosted')) });
    const server = fakeApi([profile()]);
    (server.api.tileConfig as jest.Mock).mockRejectedValue(new Error('offline'));
    render(<App locationSource={fakeGps().source} api={server.api} store={store} />);
    await waitFor(() => expect(screen.getByTestId('map-view').props.mapStyle).toBe('http://api.test/tiles/self-hosted/style.json'));
  });

  it('sets the on-device ambient cache size from the config and tags map requests with the device id', async () => {
    const { server } = await boot();
    await waitFor(() => expect(OfflineManager.setMaximumAmbientCacheSize).toHaveBeenCalledWith(268_435_456));
    await waitFor(() => expect(server.api.setDeviceId).toHaveBeenCalled());
    const id = (server.api.setDeviceId as jest.Mock).mock.calls[0]![0] as string;
    expect(TransformRequestManager.addHeader).toHaveBeenCalledWith(expect.objectContaining({ name: 'x-device-id', value: id }));
    const header = (TransformRequestManager.addHeader as jest.Mock).mock.calls.at(-1)![0] as { match: RegExp };
    expect(header.match.test('http://api.test/tiles/maptiler/proxy/x.pbf')).toBe(true);
    expect(header.match.test('https://api.maptiler.com/x.pbf')).toBe(false); // never sent to a third party
  });
});

describe('usage analytics', () => {
  it('reports one map session per map view, with the view kind', async () => {
    const { gps, server } = await boot();
    await waitFor(() => expect(server.api.reportMapSession).toHaveBeenCalledTimes(1));
    expect(server.api.reportMapSession).toHaveBeenCalledWith({ session_id: expect.stringMatching(/^[0-9a-f-]{36}$/), view: 'plan', started_at: expect.any(String) });
    fireEvent.press(screen.getByTestId('tab-facilities'));
    await waitFor(() => expect(server.api.reportMapSession).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'facility' })));
    fireEvent.press(screen.getByTestId('tab-plan'));
    await startTrip(gps);
    await waitFor(() => expect(server.api.reportMapSession).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'navigate' })));
  });

  it('the debug panel shows this device’s sessions / requests / billable requests from the server', async () => {
    await boot();
    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(screen.getByTestId('open-map-usage'));
    await waitFor(() => expect(screen.getByTestId('usage-sessions-maptiler')).toHaveTextContent('3'));
    expect(screen.getByTestId('usage-requests-maptiler')).toHaveTextContent('120');
    expect(screen.getByTestId('usage-billable-maptiler')).toHaveTextContent('96');
    expect(screen.getByText('request')).toBeTruthy(); // MapTiler bills this integration per request
  });
});
