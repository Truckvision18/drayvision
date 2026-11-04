import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../theme';

export function FacilitiesScreen() {
  return (
    <View style={styles.fill} testID="screen-Facilities">
      <Text style={styles.text}>Terminals, truck entrances and wait times arrive in Phases 9–10.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 17, textAlign: 'center' },
});
