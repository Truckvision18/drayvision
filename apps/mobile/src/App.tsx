import React, { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MotionProvider } from './safety/MotionGateContext';
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
 * Minimal tab shell — deliberately no navigation library yet, to keep native deps small until
 * the Phase 4 navigation UI settles. Motion state defaults to "unknown" (treated as moving)
 * until the location pipeline feeds the gate.
 */
export default function App() {
  const [tab, setTab] = useState<TabKey>('plan');
  const Active = TABS.find((t) => t.key === tab)?.Screen ?? PlanScreen;
  return (
    <SafeAreaProvider>
      <MotionProvider value="unknown">
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <View style={styles.body}>
            <Active />
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.key }}
                onPress={() => setTab(t.key)}
                style={styles.tab}
                testID={`tab-${t.key}`}
              >
                <Text style={[styles.tabText, tab === t.key && styles.tabActive]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </MotionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface },
  tab: { flex: 1, minHeight: touch.minTarget, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  tabActive: { color: colors.accent },
});
