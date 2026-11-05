import React, { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { RoutingApi } from './api/client';
import {
  LocationProvider,
  type LocationSource,
} from './location/LocationContext';
import { NavProvider, useNav } from './navigation/NavContext';
import { FacilitiesScreen } from './screens/FacilitiesScreen';
import { KnowBeforeYouGoScreen } from './screens/KnowBeforeYouGoScreen';
import { NavigateScreen } from './screens/NavigateScreen';
import { PlanScreen } from './screens/PlanScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { colors, touch } from './theme';

const TABS = [
  { key: 'plan', label: 'Plan', Screen: PlanScreen },
  { key: 'navigate', label: 'Navigate', Screen: NavigateScreen },
  { key: 'kbyg', label: 'Know Before', Screen: KnowBeforeYouGoScreen },
  { key: 'facilities', label: 'Facilities', Screen: FacilitiesScreen },
  { key: 'settings', label: 'Settings', Screen: SettingsScreen },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * App shell. One GPS feed (LocationProvider → also drives the parked/moving gate) and one
 * navigation state (NavProvider). `api` / `locationSource` are injectable for tests.
 */
export default function App({
  api,
  locationSource,
}: { api?: RoutingApi; locationSource?: LocationSource } = {}) {
  return (
    <SafeAreaProvider>
      <LocationProvider {...(locationSource ? { source: locationSource } : {})}>
        <NavProvider {...(api ? { api } : {})}>
          <Shell />
        </NavProvider>
      </LocationProvider>
    </SafeAreaProvider>
  );
}

/**
 * Minimal tab shell — deliberately no navigation library yet, to keep native deps small.
 * Starting a trip jumps to Navigate.
 */
function Shell() {
  const [tab, setTab] = useState<TabKey>('plan');
  const { state } = useNav();
  useEffect(() => {
    if (state.phase === 'navigating') setTab('navigate');
  }, [state.phase]);
  const Active = TABS.find(t => t.key === tab)?.Screen ?? PlanScreen;
  return (
    <>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Active />
        </View>
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map(t => (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.key }}
              onPress={() => setTab(t.key)}
              style={styles.tab}
              testID={`tab-${t.key}`}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabActive]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface },
  tab: {
    flex: 1,
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  tabActive: { color: colors.accent },
});
