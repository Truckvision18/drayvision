import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { metresToFeet, kgToPounds } from '@drayvision/shared';
import { useNav } from '../navigation/NavContext';
import { colors, space } from '../theme';

const ftIn = (m: number): string => {
  const total = metresToFeet(m);
  let ft = Math.floor(total);
  let inch = Math.round((total - ft) * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return `${ft}' ${inch}"`;
};

/** Truck profile used for routing. Editing (parked-only) lands with profile persistence. */
export function SettingsScreen() {
  const { profile } = useNav();
  const rows: Array<[string, string]> = [
    ['Height', ftIn(profile.heightM)],
    ['Width', ftIn(profile.widthM)],
    ['Length', ftIn(profile.lengthM)],
    ['Gross weight', `${Math.round(kgToPounds(profile.grossWeightKg)).toLocaleString('en-US')} lb`],
    ['Axles', String(profile.axleCount)],
    ['Hazmat', profile.hazmat.length ? profile.hazmat.map((c) => `Class ${c}`).join(', ') : 'None'],
  ];
  return (
    <View style={styles.fill} testID="screen-Settings">
      <Text style={styles.title}>{profile.name}</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.key}>{k}</Text>
          <Text style={styles.value}>{v}</Text>
        </View>
      ))}
      <Text style={styles.note}>Routes are planned for these dimensions. Editing your rig arrives with profile storage.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg, padding: space.lg },
  title: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.surface },
  key: { color: colors.muted, fontSize: 17 },
  value: { color: colors.text, fontSize: 17, fontWeight: '600' },
  note: { color: colors.muted, marginTop: space.lg },
});
