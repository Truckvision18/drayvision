import React from 'react';
import { FlatList, Image, StyleSheet, Text } from 'react-native';
import { ParkedOnly } from '../safety/MotionGateContext';
import { colors, space } from '../theme';

export interface PreviewImage {
  id: string;
  uri: string;
  caption: string;
}

/** "Know Before You Go" approach imagery (Phase 9). Parked-only. */
export function PreviewGallery({ images }: { images: PreviewImage[] }) {
  return (
    <ParkedOnly feature="preview-gallery" fallback={<Text style={styles.muted}>Previews available when parked</Text>}>
      {images.length === 0 ? (
        <Text style={styles.muted}>No previews for this stop yet</Text>
      ) : (
        <FlatList
          horizontal
          data={images}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => <Image source={{ uri: item.uri }} style={styles.img} accessibilityLabel={item.caption} />}
        />
      )}
    </ParkedOnly>
  );
}

const styles = StyleSheet.create({
  img: { width: 280, height: 160, borderRadius: 8, marginRight: space.sm },
  muted: { color: colors.muted, padding: space.md },
});
