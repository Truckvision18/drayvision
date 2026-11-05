import React from 'react';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import type { LngLat, Route } from '@drayvision/shared';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

/** Draws a route (casing + line) and the destination pin. */
export function RouteLine({ route, destination }: { route: Route | null; destination: LngLat | null }) {
  return (
    <>
      {route ? (
        <GeoJSONSource
          id="route"
          data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.geometry.map((c) => [c[0], c[1]]) } }}
        >
          <Layer id="route-casing" type="line" paint={{ 'line-color': '#0b3d91', 'line-width': 10 }} layout={{ 'line-join': 'round', 'line-cap': 'round' }} />
          <Layer id="route-line" type="line" paint={{ 'line-color': '#3d8bfd', 'line-width': 6 }} layout={{ 'line-join': 'round', 'line-cap': 'round' }} />
        </GeoJSONSource>
      ) : null}
      {destination ? (
        <Marker id="destination" lngLat={[destination.lng, destination.lat]}>
          <View style={styles.pin} accessibilityLabel="Destination" testID="destination-pin" />
        </Marker>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pin: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
});
