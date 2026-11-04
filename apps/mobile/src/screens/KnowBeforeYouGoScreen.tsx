import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../theme';

export function KnowBeforeYouGoScreen() {
  return (
    <View style={styles.fill} testID="screen-KnowBeforeYouGo">
      <Text style={styles.text}>Approach previews and cameras arrive in Phases 8–9.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 17, textAlign: 'center' },
});
