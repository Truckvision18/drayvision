import React, { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteCard } from '../components/RouteCard';
import { DestinationPin } from '../map/DestinationPin';
import { MapView, type MapRef } from '../map/MapView';
import { shareRoute } from '../map/share';
import { useTileConfig } from '../map/TileConfigContext';
import { Button } from '../components/ui';
import { useLocation } from '../location/LocationContext';
import { useNav } from '../navigation/NavContext';
import { activeRoute } from '../navigation/navState';
import { useProfiles } from '../profiles/ProfileContext';
import { colors, space } from '../theme';

/**
 * Plan a trip: long-press the map to drop a destination, get truck-safe routes from our API,
 * pick one, start. (Address search needs a geocoder — a metered provider, not yet chosen.)
 */
export function PlanScreen({ onOpenProfiles }: { onOpenProfiles: () => void }) {
  const { state, dispatch } = useNav();
  const { permission } = useLocation();
  const { active, completeness, status } = useProfiles();
  const routable = completeness?.complete === true;
  const { tileConfig } = useTileConfig();
  const mapRef = useRef<MapRef>(null);

  return (
    <View style={styles.fill} testID="plan-screen">
      <View style={styles.profileBar} testID="profile-bar">
        <Text style={styles.profileText} numberOfLines={1}>
          {active ? `Routing as: ${active.name}` : status === 'loading' ? 'Loading truck profiles…' : 'No truck profile'}
        </Text>
        <Button label="Trucks" kind="secondary" onPress={onOpenProfiles} testID="open-profiles" />
      </View>
      <MapView ref={mapRef} view="plan" route={activeRoute(state)} onLongPress={(at) => dispatch({ type: 'SET_DESTINATION', destination: at })}>
        {state.destination ? <DestinationPin at={state.destination} /> : null}
      </MapView>
      <View style={styles.panel}>{panel()}</View>
    </View>
  );

  function panel(): React.ReactNode {
    // No route of any kind without a complete truck profile — and no guessed stand-in.
    if (status !== 'loading' && !routable && state.phase !== 'navigating' && state.phase !== 'rerouting') {
      return (
        <View testID="complete-profile">
          <Text style={[styles.hint, styles.blocker]}>
            {completeness?.message ?? 'Add your truck profile — DrayVision plans routes for your exact rig.'}
          </Text>
          <View style={styles.row}>
            <Button label={active ? 'Complete truck profile' : 'Add truck profile'} onPress={onOpenProfiles} testID="complete-profile-button" />
          </View>
        </View>
      );
    }
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
                <RouteCard key={r.route_id} route={r} selected={i === state.selected} onPress={() => dispatch({ type: 'SELECT', index: i })} />
              ))}
            </ScrollView>
            <View style={styles.row}>
              <Button label="Cancel" kind="secondary" onPress={() => dispatch({ type: 'CANCEL' })} />
              <Button
                label="Share"
                kind="secondary"
                onPress={() => {
                  const r = activeRoute(state);
                  if (r) void shareRoute(r, tileConfig, mapRef.current);
                }}
                testID="share-route"
              />
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  panel: { backgroundColor: colors.bg, padding: space.md, maxHeight: '45%' },
  cards: { flexGrow: 0 },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  hint: { color: colors.muted, fontSize: 17, textAlign: 'center', paddingVertical: space.sm },
  blocker: { color: colors.warn, fontWeight: '600' },
  profileBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, backgroundColor: colors.bg },
  profileText: { flex: 3, color: colors.text, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger },
});
