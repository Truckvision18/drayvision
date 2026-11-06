import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { TOGGLEABLE_LAYERS, type ToggleableLayer } from '@drayvision/shared';
import { colors, space, touch } from '../theme';
import { useMapLayers } from './MapLayersContext';

const LABELS: Record<ToggleableLayer, string> = {
  hazards: 'Truck restrictions',
  traffic: 'Traffic incidents',
  cameras: 'Traffic cameras',
  facilities: 'Facilities & truck gates',
  sponsored: 'Sponsored places',
};

/** Layer switches, shared by every map. Listed top-of-stack last, like the map draws them. */
export function LayerToggles() {
  const { toggles, setLayer, blocked } = useMapLayers();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} style={styles.button} testID="layers-button">
        <Text style={styles.buttonText}>Layers</Text>
      </Pressable>
      {open ? (
        <View style={styles.panel} testID="layers-panel">
          {TOGGLEABLE_LAYERS.map((l) => (
            <View key={l} style={styles.row}>
              <View style={styles.labelCol}>
                <Text style={styles.label}>{LABELS[l]}</Text>
                {blocked[l] ? <Text style={styles.note}>{blocked[l]}</Text> : null}
              </View>
              <Switch value={toggles[l]} onValueChange={(v) => setLayer(l, v)} testID={`toggle-${l}`} accessibilityLabel={LABELS[l]} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: space.sm, right: space.sm, alignItems: 'flex-end', maxWidth: '90%' },
  button: { minHeight: touch.minTarget, minWidth: touch.minTarget, paddingHorizontal: space.md, borderRadius: 12, backgroundColor: colors.surface, justifyContent: 'center' },
  buttonText: { color: colors.text, fontWeight: '700' },
  panel: { marginTop: space.xs, backgroundColor: colors.surface, borderRadius: 12, padding: space.sm, width: 280, maxWidth: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  labelCol: { flexShrink: 1, paddingRight: space.sm },
  label: { color: colors.text, fontSize: 15 },
  note: { color: colors.warn, fontSize: 12 },
});
