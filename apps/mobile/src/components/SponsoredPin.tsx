import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import type { SponsoredListing } from '@drayvision/shared';
import { colors } from '../theme';

/** Sponsored map pin. Always visibly labelled "Sponsored" — never styled like a safety marker. */
export function SponsoredPin({ listing }: { listing: SponsoredListing }) {
  return (
    <Marker id={`sponsored-${listing.id}`} lngLat={[listing.location.lng, listing.location.lat]}>
      <View style={styles.pin} accessibilityLabel={`Sponsored: ${listing.title}`}>
        <Text style={styles.label}>{listing.label}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  pin: { backgroundColor: colors.sponsored, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  label: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
