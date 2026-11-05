import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Maneuver, ManeuverType } from '@drayvision/shared';
import { formatDistance } from '../navigation/format';
import { colors, space } from '../theme';

const ARROWS: Partial<Record<ManeuverType, string>> = {
  left: '←',
  'sharp-left': '↰',
  'slight-left': '↖',
  right: '→',
  'sharp-right': '↱',
  'slight-right': '↗',
  uturn: '↶',
  'keep-left': '↖',
  'keep-right': '↗',
  'exit-left': '↖',
  'exit-right': '↗',
  arrive: '◎',
  'roundabout-enter': '↻',
};

/** Big, glanceable next-maneuver banner: arrow, distance, instruction. */
export function ManeuverBanner({ maneuver, distanceM }: { maneuver: Maneuver; distanceM: number }) {
  return (
    <View style={styles.banner} testID="maneuver-banner" accessibilityLiveRegion="polite">
      <Text style={styles.arrow}>{ARROWS[maneuver.type] ?? '↑'}</Text>
      <View style={styles.text}>
        <Text style={styles.distance}>{formatDistance(distanceM)}</Text>
        <Text style={styles.instruction} numberOfLines={2}>
          {maneuver.instruction}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#14532d', padding: space.md },
  arrow: { color: '#fff', fontSize: 48, width: 64, textAlign: 'center' },
  text: { flex: 1 },
  distance: { color: '#fff', fontSize: 30, fontWeight: '800' },
  instruction: { color: colors.text, fontSize: 18 },
});
