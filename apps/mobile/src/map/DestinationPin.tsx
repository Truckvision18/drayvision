import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import type { LngLat } from '@drayvision/shared';
import { colors } from '../theme';

export function DestinationPin({ at }: { at: LngLat }) {
  return (
    <Marker id="destination" lngLat={[at.lng, at.lat]}>
      <View style={styles.pin} accessibilityLabel="Destination" testID="destination-pin" />
    </Marker>
  );
}

const styles = StyleSheet.create({
  pin: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
});
