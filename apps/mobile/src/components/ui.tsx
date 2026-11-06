import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, space, touch } from '../theme';

/** Shared in-cab controls: big touch targets, high contrast. */
export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.button, kind === 'secondary' && styles.secondary, kind === 'danger' && styles.danger, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flex: 1, minHeight: touch.minTarget, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  secondary: { backgroundColor: colors.surface },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  chip: { minHeight: 44, paddingHorizontal: space.md, borderRadius: 22, borderWidth: 1, borderColor: colors.muted, justifyContent: 'center', marginRight: space.sm, marginBottom: space.sm },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 15 },
  chipTextOn: { color: '#fff', fontWeight: '700' },
});
