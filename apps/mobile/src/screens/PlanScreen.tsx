import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MapView } from '../components/MapView';

/** Phase 1 acceptance: launches to an empty map. Route search UI arrives with Phase 4. */
export function PlanScreen() {
  return (
    <View style={styles.fill} testID="plan-screen">
      <MapView />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
