import React, { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { ProfilesApi, RoutingApi } from './api/client';
import {
  LocationProvider,
  type LocationSource,
} from './location/LocationContext';
import { NavProvider, useNav } from './navigation/NavContext';
import { ProfileProvider, type KeyValueStore } from './profiles/ProfileContext';
import { FacilitiesScreen } from './screens/FacilitiesScreen';
import { KnowBeforeYouGoScreen } from './screens/KnowBeforeYouGoScreen';
import { NavigateScreen } from './screens/NavigateScreen';
import { PlanScreen } from './screens/PlanScreen';
import { ProfilesScreen } from './screens/ProfilesScreen';
import { colors, touch } from './theme';

const TABS = [
  { key: 'plan', label: 'Plan' },
  { key: 'navigate', label: 'Navigate' },
  { key: 'kbyg', label: 'Know Before' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'settings', label: 'Trucks' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * App shell. One GPS feed (LocationProvider → also drives the parked/moving gate), the
 * account's truck profiles (ProfileProvider: server-backed, cached on device) and one
 * navigation state (NavProvider, which always routes for the active profile).
 * `api` / `locationSource` / `store` are injectable for tests.
 */
export default function App({
  api,
  locationSource,
  store,
}: {
  api?: RoutingApi & ProfilesApi;
  locationSource?: LocationSource;
  store?: KeyValueStore;
} = {}) {
  return (
    <SafeAreaProvider>
      <LocationProvider {...(locationSource ? { source: locationSource } : {})}>
        <ProfileProvider
          {...(api ? { api } : {})}
          {...(store ? { store } : {})}
        >
          <NavProvider {...(api ? { api } : {})}>
            <Shell />
          </NavProvider>
        </ProfileProvider>
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
  const screen = (() => {
    switch (tab) {
      case 'plan':
        return <PlanScreen onOpenProfiles={() => setTab('settings')} />;
      case 'navigate':
        return <NavigateScreen />;
      case 'kbyg':
        return <KnowBeforeYouGoScreen />;
      case 'facilities':
        return <FacilitiesScreen />;
      case 'settings':
        return <ProfilesScreen />;
    }
  })();
  return (
    <>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.body}>{screen}</View>
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
