/* global jest */
// Native MapLibre views can't render under Jest: replace them with plain host components so
// screens render and tests can assert on props (e.g. which style URL the map was given).
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const host = (name) => {
    const C = ({ children, ...props }) => React.createElement(View, { testID: props.testID ?? name, ...props }, children);
    C.displayName = name;
    return C;
  };
  // The map forwards a ref exposing the snapshot API used by "share".
  const Map = React.forwardRef(({ children, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({ createStaticMapImage: jest.fn(async () => 'file:///snapshot.png') }));
    return React.createElement(View, { testID: props.testID ?? 'MapLibreMap', ...props }, children);
  });
  Map.displayName = 'MapLibreMap';
  return {
    Map,
    Camera: host('MapLibreCamera'),
    Marker: host('MapLibreMarker'),
    GeoJSONSource: host('MapLibreGeoJSONSource'),
    Layer: host('MapLibreLayer'),
    UserLocation: host('MapLibreUserLocation'),
    OfflineManager: {
      setMaximumAmbientCacheSize: jest.fn(async () => undefined),
      getPacks: jest.fn(async () => []),
      createPack: jest.fn(async () => ({})),
      deletePack: jest.fn(async () => undefined),
    },
    TransformRequestManager: { addHeader: jest.fn(() => 'id'), removeHeader: jest.fn() },
    LocationManager: {
      requestPermissions: async () => false,
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  };
});

// Tests must never hit the network: fail loudly if anything calls fetch unmocked.
global.fetch = jest.fn(() => Promise.reject(new Error('fetch is not mocked in this test')));

// SafeAreaProvider waits for native insets before rendering children; use the library's mock.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Device storage: the library's in-memory mock (tests that care inject their own store).
jest.mock('@react-native-async-storage/async-storage', () => {
  const mock = require('@react-native-async-storage/async-storage/jest');
  return mock;
});
