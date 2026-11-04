import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../theme';

export function NavigateScreen() {
  return (
    <View style={styles.fill} testID="screen-Navigate">
      <Text style={styles.text}>Turn-by-turn guidance arrives in Phases 4–5.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 17, textAlign: 'center' },
});
