import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { profileCompleteness, type TruckProfile } from '@drayvision/shared';
import { Button } from '../components/ui';
import { summary } from '../profiles/form';
import { useProfiles } from '../profiles/ProfileContext';
import { colors, space } from '../theme';
import { ProfileEditor } from './ProfileEditor';

/**
 * The driver's saved trucks (several tractors / loads). One is active for routing; the account
 * default is used on a new device. Incomplete profiles are flagged — they can't be routed with.
 */
export function ProfilesScreen() {
  const p = useProfiles();
  const [editing, setEditing] = useState<TruckProfile | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (editing !== null) return <ProfileEditor profile={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;

  const act = (fn: () => Promise<unknown>) => () =>
    void fn().then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong'),
    );

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} testID="screen-Settings">
      <Text style={styles.title}>Truck profiles</Text>
      {p.status === 'offline' ? <Text style={styles.warn}>Offline — showing profiles saved on this device.</Text> : null}
      {p.profiles.length === 0 && p.status !== 'loading' ? (
        <Text style={styles.hint} testID="no-profiles">
          Add your truck so DrayVision can plan routes that fit it.
        </Text>
      ) : null}

      {p.profiles.map((t) => {
        const c = profileCompleteness(t);
        const isActive = p.active?.id === t.id;
        return (
          <View key={t.id} style={[styles.card, isActive && styles.cardActive]} testID={`profile-${t.id}`}>
            <View style={styles.cardHead}>
              <Text style={styles.name}>{t.name}</Text>
              <View style={styles.badges}>
                {t.is_default ? <Text style={styles.badge}>Default</Text> : null}
                {isActive ? <Text style={[styles.badge, styles.badgeActive]}>Routing</Text> : null}
              </View>
            </View>
            <Text style={styles.summary}>{summary(t)}</Text>
            {!c.complete ? (
              <Text style={styles.incomplete} testID={`incomplete-${t.id}`}>
                Incomplete — missing {c.missing_fields.map((f) => f.replace(/_m$|_kg$|_count$/, '').replace('_', ' ')).join(', ')}
              </Text>
            ) : null}
            <View style={styles.row}>
              {!isActive ? <Button label="Use for routing" kind="secondary" onPress={() => p.activate(t.id)} testID={`activate-${t.id}`} /> : null}
              <Button label="Edit" kind="secondary" onPress={() => setEditing(t)} testID={`edit-${t.id}`} />
            </View>
            <View style={styles.row}>
              {!t.is_default ? <Button label="Make default" kind="secondary" onPress={act(() => p.makeDefault(t.id))} testID={`default-${t.id}`} /> : null}
              {confirmDelete === t.id ? (
                <Button label="Tap again to delete" kind="danger" onPress={act(() => p.remove(t.id))} testID={`confirm-delete-${t.id}`} />
              ) : (
                <Button label="Delete" kind="secondary" onPress={() => setConfirmDelete(t.id)} testID={`delete-${t.id}`} />
              )}
            </View>
          </View>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Button label="Add truck profile" onPress={() => setEditing('new')} testID="add-profile" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 16 },
  warn: { color: colors.warn },
  error: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: space.md, gap: space.sm },
  cardActive: { borderWidth: 2, borderColor: colors.accent },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
  badges: { flexDirection: 'row', gap: space.xs },
  badge: { color: colors.text, fontSize: 12, fontWeight: '700', borderWidth: 1, borderColor: colors.muted, borderRadius: 6, paddingHorizontal: 6 },
  badgeActive: { borderColor: colors.accent, color: colors.accent },
  summary: { color: colors.muted, fontSize: 15 },
  incomplete: { color: colors.warn, fontWeight: '600' },
  row: { flexDirection: 'row', gap: space.sm },
});
