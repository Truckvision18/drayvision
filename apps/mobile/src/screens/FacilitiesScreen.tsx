import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Facility } from '@drayvision/shared';
import { useApi } from '../api/ApiContext';
import type { BBox } from '../api/client';
import { MapView } from '../map/MapView';
import { colors, space } from '../theme';

const SOURCE_LABEL: Record<Facility['truck_entrances'][number]['source'], string> = {
  OFFICIAL: 'official gate',
  DRIVER_VERIFIED: 'driver-verified gate',
  UNVERIFIED: 'unverified gate',
};

/**
 * Facility view: the same map, with facilities + truck entrances on, and the facilities in view
 * listed underneath (primary gate first). Waits, docks and notes arrive with Phases 9–10.
 */
export function FacilitiesScreen() {
  const api = useApi();
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);

  useEffect(() => {
    if (!bbox) return;
    let live = true;
    api.facilities(bbox).then(
      (f) => live && setFacilities(f),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, bbox]);

  return (
    <View style={styles.fill} testID="screen-Facilities">
      <View style={styles.map}>
        <MapView view="facility" onBoundsChange={setBbox} />
      </View>
      <FlatList
        style={styles.list}
        data={facilities}
        keyExtractor={(f) => f.id}
        ListEmptyComponent={<Text style={styles.muted}>No facilities in this area yet.</Text>}
        renderItem={({ item }) => {
          const gate = item.truck_entrances.find((e) => e.is_primary);
          return (
            <View style={styles.row} testID={`facility-${item.id}`}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.muted}>
                {gate ? `Truck entrance: ${gate.street} (${SOURCE_LABEL[gate.source]})` : 'No truck entrance on file — can’t route here yet'}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 3 },
  list: { flex: 2 },
  row: { padding: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.surface },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted, padding: space.xs },
});
