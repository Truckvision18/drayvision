import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../theme';

export function SettingsScreen() {
  return (
    <View style={styles.fill} testID="screen-Settings">
      <Text style={styles.text}>Truck profile and preferences.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 17, textAlign: 'center' },
});
