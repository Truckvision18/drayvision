import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { OSM_ATTRIBUTION, type Attribution } from '@drayvision/shared';

/** OSM attribution is mandatory on every map; never drop it even if a config omits it. */
export function attributionItems(fromConfig: Attribution[]): Attribution[] {
  return fromConfig.some((a) => a.url === OSM_ATTRIBUTION.url) ? fromConfig : [...fromConfig, OSM_ATTRIBUTION];
}

export const attributionLine = (items: Attribution[]): string => attributionItems(items).map((a) => a.text).join(' ');

/**
 * Always-visible attribution, drawn by us on top of every map (MapTiler: "attribution is
 * required to be shown on screen while the map is displayed"). Each item links to its source.
 * Rendered outside the GL surface so it can never be hidden by map layers.
 */
export function MapAttribution({ items }: { items: Attribution[] }) {
  const all = attributionItems(items);
  return (
    <View style={styles.box} pointerEvents="box-none" testID="map-attribution" accessibilityRole="text" accessibilityLabel={`Map data: ${attributionLine(all)}`}>
      {all.map((a) => (
        <Pressable key={a.url} onPress={() => void Linking.openURL(a.url)} accessibilityRole="link" hitSlop={8}>
          <Text style={styles.text}>{a.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: '75%',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  text: { color: '#222', fontSize: 10 },
});
