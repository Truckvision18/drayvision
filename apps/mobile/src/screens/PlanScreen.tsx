import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MapView } from '../components/MapView';
import { RouteCard } from '../components/RouteCard';
import { RouteLine } from '../components/RouteLine';
import { useLocation } from '../location/LocationContext';
import { useNav } from '../navigation/NavContext';
import { activeRoute } from '../navigation/navState';
import { colors, space, touch } from '../theme';

/**
 * Plan a trip: long-press the map to drop a destination, get truck-safe routes from our API,
 * pick one, start. (Address search needs a geocoder — a metered provider, not yet chosen.)
 */
export function PlanScreen() {
  const { state, dispatch } = useNav();
  const { permission } = useLocation();

  return (
    <View style={styles.fill} testID="plan-screen">
      <MapView onLongPress={(at) => dispatch({ type: 'SET_DESTINATION', destination: at })}>
        <RouteLine route={activeRoute(state)} destination={state.destination} />
      </MapView>
      <View style={styles.panel}>{panel()}</View>
    </View>
  );

  function panel(): React.ReactNode {
    if (permission === 'denied') return <Text style={styles.hint}>Location permission is off — DrayVision needs it to route from where you are.</Text>;
    switch (state.phase) {
      case 'idle':
        return state.destination ? (
          <Button label="Find truck route" onPress={() => dispatch({ type: 'PLAN' })} testID="find-route" />
        ) : (
          <Text style={styles.hint}>Long-press the map to set a destination</Text>
        );
      case 'planning':
        return <Text style={styles.hint}>Finding a truck-safe route…</Text>;
      case 'previewing':
        return (
          <>
            <ScrollView style={styles.cards}>
              {state.routes.map((r, i) => (
                <RouteCard key={r.id} route={r} selected={i === state.selected} onPress={() => dispatch({ type: 'SELECT', index: i })} />
              ))}
            </ScrollView>
            <View style={styles.row}>
              <Button label="Cancel" kind="secondary" onPress={() => dispatch({ type: 'CANCEL' })} />
              <Button label="Start" onPress={() => dispatch({ type: 'START' })} testID="start-nav" />
            </View>
          </>
        );
      case 'error':
        return (
          <>
            <Text style={[styles.hint, styles.error]} testID="plan-error">
              {state.message}
            </Text>
            <View style={styles.row}>
              <Button label="Clear" kind="secondary" onPress={() => dispatch({ type: 'CANCEL' })} />
              {state.destination ? <Button label="Try again" onPress={() => dispatch({ type: 'PLAN' })} /> : null}
            </View>
          </>
        );
      default:
        return <Text style={styles.hint}>Trip in progress — see Navigate</Text>;
    }
  }
}

function Button({ label, onPress, kind = 'primary', testID }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={[styles.button, kind === 'secondary' && styles.secondary]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { backgroundColor: colors.bg, padding: space.md, maxHeight: '45%' },
  cards: { flexGrow: 0 },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  hint: { color: colors.muted, fontSize: 17, textAlign: 'center', paddingVertical: space.sm },
  error: { color: colors.danger },
  button: { flex: 1, minHeight: touch.minTarget, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.surface },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
