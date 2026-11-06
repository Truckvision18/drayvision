import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ManeuverBanner } from '../components/ManeuverBanner';
import { MapView } from '../components/MapView';
import { RouteLine } from '../components/RouteLine';
import { useNav } from '../navigation/NavContext';
import { activeRoute } from '../navigation/navState';
import { formatDistance, formatDuration } from '../navigation/format';
import { colors, space, touch } from '../theme';

/** Turn-by-turn guidance. Everything here is glanceable — no text entry, no galleries. */
export function NavigateScreen() {
  const { state, dispatch } = useNav();
  const route = activeRoute(state);

  if (!route || (state.phase !== 'navigating' && state.phase !== 'rerouting' && state.phase !== 'arrived')) {
    return (
      <View style={styles.empty} testID="screen-Navigate">
        <Text style={styles.muted}>No active trip — plan one on the Plan tab.</Text>
      </View>
    );
  }

  const maneuvers = route.maneuvers;
  const progress = state.phase === 'navigating' ? state.progress : null;
  const next = progress ? maneuvers[progress.nextManeuverIndex] : maneuvers[1] ?? maneuvers[0];
  const toNext = progress ? progress.distanceToNextManeuverM : maneuvers[0]?.distance_m ?? 0;

  return (
    <View style={styles.fill} testID="screen-Navigate">
      {state.phase === 'rerouting' ? (
        <View style={[styles.status, styles.rerouting]} testID="rerouting-banner">
          <Text style={styles.statusText}>Off route — finding a truck-safe way back…</Text>
        </View>
      ) : state.phase === 'arrived' ? (
        <View style={[styles.status, styles.arrived]} testID="arrived-banner">
          <Text style={styles.statusText}>You have arrived</Text>
        </View>
      ) : next ? (
        <ManeuverBanner maneuver={next} distanceM={toNext} />
      ) : null}

      <MapView followUser={state.phase !== 'arrived'}>
        <RouteLine route={route} destination={state.destination} />
      </MapView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.big} testID="remaining">
            {formatDuration(progress?.remainingS ?? route.duration_s)} · {formatDistance(progress?.remainingM ?? route.distance_m)}
          </Text>
          <Text style={styles.muted} testID="route-versions">
            Graph {route.data_versions.routing_graph} · restrictions {route.data_versions.restrictions} · truck v{route.data_versions.truck_profile_version}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'CANCEL' })} style={styles.end} testID="end-trip">
          <Text style={styles.endText}>{state.phase === 'arrived' ? 'Done' : 'End'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center' },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  status: { padding: space.md },
  rerouting: { backgroundColor: '#7c2d12' },
  arrived: { backgroundColor: '#14532d' },
  statusText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.md, backgroundColor: colors.surface },
  big: { color: colors.text, fontSize: 22, fontWeight: '700' },
  end: { minHeight: touch.minTarget, minWidth: 96, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
