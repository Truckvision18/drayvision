import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { metresToMiles, type Route } from '@drayvision/shared';
import { colors, space, touch } from '../theme';

const statusColor = { PASS: colors.ok, WARN: colors.warn, FAIL: colors.danger } as const;

export function RouteCard({ route, selected, onPress }: { route: Route; selected?: boolean; onPress?: () => void }) {
  const miles = metresToMiles(route.distance_m).toFixed(1);
  const mins = Math.round(route.duration_s / 60);
  const v = route.safety_result;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.card, selected && styles.selected]} testID={`route-card-${route.route_id}`}>
      <View style={styles.row}>
        <Text style={styles.title}>{mins} min · {miles} mi</Text>
        <Text style={[styles.badge, { color: statusColor[v.status] }]}>{v.status}</Text>
      </View>
      {v.warnings.length > 0 ? <Text style={styles.sub}>{v.warnings.length} caution(s) on route</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, padding: space.md, borderRadius: 12, minHeight: touch.minTarget, marginBottom: space.sm },
  selected: { borderWidth: 2, borderColor: colors.accent },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  badge: { fontSize: 14, fontWeight: '700' },
  sub: { color: colors.muted, marginTop: space.xs, fontSize: 15 },
});
