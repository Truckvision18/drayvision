import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Camera } from '@drayvision/shared';
import { ParkedOnly } from '../safety/MotionGateContext';
import { colors, space } from '../theme';

/** Traffic camera still. Images only while parked (Phase 8); attribution always shown. */
export function CameraCard({ camera }: { camera: Camera }) {
  return (
    <View style={styles.card} testID={`camera-card-${camera.id}`}>
      <Text style={styles.title}>{camera.name}</Text>
      <ParkedOnly feature="camera-stills" fallback={<Text style={styles.muted}>Camera images available when parked</Text>}>
        {camera.imageUrl ? <Image source={{ uri: camera.imageUrl }} style={styles.image} accessibilityLabel={camera.name} /> : null}
      </ParkedOnly>
      <Text style={styles.attribution}>{camera.attribution}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, padding: space.md, borderRadius: 12, marginBottom: space.sm },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  image: { width: '100%', aspectRatio: 16 / 9, marginTop: space.sm, borderRadius: 8 },
  muted: { color: colors.muted, marginTop: space.sm },
  attribution: { color: colors.muted, fontSize: 11, marginTop: space.xs },
});
