import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HazmatClassSchema, TransponderNetworkSchema, type HazmatClass, type TransponderNetwork, type TruckProfile } from '@drayvision/shared';
import { ApiError } from '../api/client';
import { Button, Chip } from '../components/ui';
import { useLocation } from '../location/LocationContext';
import { fromForm, toCreate, toForm, toPatch, type FormErrors, type ProfileForm } from '../profiles/form';
import { useProfiles } from '../profiles/ProfileContext';
import { ParkedOnly } from '../safety/MotionGateContext';
import { colors, space } from '../theme';

const HAZMAT_CLASSES = HazmatClassSchema.options.map((o) => o.value) as HazmatClass[];
const NETWORKS = TransponderNetworkSchema.options;
const networkLabel = (n: TransponderNetwork): string => (n === 'E_ZPASS' ? 'E-ZPass' : n.replace(/_/g, ' '));

/**
 * Create / edit a truck profile. Text entry is distracting, so the whole editor is parked-only.
 * Saving with blanks is allowed (a draft), but the screen says plainly that routing waits until
 * the profile is complete.
 */
export function ProfileEditor({ profile, onDone }: { profile: TruckProfile | null; onDone: () => void }) {
  return (
    <ParkedOnly
      feature="settings-edit"
      fallback={
        <View style={styles.locked} testID="editor-locked">
          <Text style={styles.lockedText}>Truck profiles can be edited when you're parked.</Text>
          <Button label="Back" kind="secondary" onPress={onDone} />
        </View>
      }
    >
      <EditorForm profile={profile} onDone={onDone} />
    </ParkedOnly>
  );
}

function EditorForm({ profile, onDone }: { profile: TruckProfile | null; onDone: () => void }) {
  const { create, update, refresh } = useProfiles();
  const { fix } = useLocation();
  const [form, setForm] = useState<ProfileForm>(() => toForm(profile));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save(): Promise<void> {
    const { values, errors: errs } = fromForm(form, profile);
    setErrors(errs);
    setSaveError(null);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      if (profile === null) await create(toCreate(values));
      else {
        const patch = toPatch(profile, values);
        if (patch) await update(profile.id, patch);
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        await refresh();
        setSaveError('This truck was changed on another device. Your edit was not saved — reopen the profile to see the latest and try again.');
      } else setSaveError(err instanceof Error ? err.message : 'Could not save the profile');
    } finally {
      setSaving(false);
    }
  }

  const input = (testID: string, value: string, onChange: (s: string) => void, placeholder: string, numeric = true) => (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType={numeric ? 'numeric' : 'default'}
      style={styles.input}
    />
  );
  const err = (k: keyof FormErrors) => (errors[k] ? <Text style={styles.error} testID={`error-${k}`}>{errors[k]}</Text> : null);

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content} testID="profile-editor" keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{profile ? `Edit ${profile.name}` : 'New truck profile'}</Text>
      <Text style={styles.hint}>Routing, tolls and safety checks all use these numbers. Leave a field blank if you don't know it yet — DrayVision won't route until it's filled in, and never guesses.</Text>

      <Text style={styles.label}>Name</Text>
      {input('field-name', form.name, (v) => set('name', v), "e.g. Volvo + 40' chassis", false)}
      {err('name')}

      <Text style={styles.label}>Height (loaded, to the top of the box)</Text>
      <View style={styles.row}>
        {input('field-height-ft', form.heightFt, (v) => set('heightFt', v), 'ft')}
        {input('field-height-in', form.heightIn, (v) => set('heightIn', v), 'in')}
      </View>
      {err('height')}

      <Text style={styles.label}>Gross weight (lb)</Text>
      {input('field-weight', form.weightLb, (v) => set('weightLb', v), 'e.g. 80000')}
      {err('weight')}

      <Text style={styles.label}>Overall length (ft)</Text>
      {input('field-length', form.lengthFt, (v) => set('lengthFt', v), 'e.g. 69')}
      {err('length')}

      <Text style={styles.label}>Width</Text>
      <View style={styles.row}>
        {input('field-width-ft', form.widthFt, (v) => set('widthFt', v), 'ft')}
        {input('field-width-in', form.widthIn, (v) => set('widthIn', v), 'in')}
      </View>
      {err('width')}

      <Text style={styles.label}>Axles</Text>
      {input('field-axles', form.axles, (v) => set('axles', v), 'e.g. 5')}
      {err('axles')}

      <Text style={styles.label}>Carrying hazmat?</Text>
      <View style={styles.wrap}>
        <Chip label="No" selected={form.hazmat === 'no'} onPress={() => set('hazmat', 'no')} testID="hazmat-no" />
        <Chip label="Yes" selected={form.hazmat === 'yes'} onPress={() => set('hazmat', 'yes')} testID="hazmat-yes" />
      </View>
      {form.hazmat === 'yes' ? (
        <View style={styles.wrap}>
          {HAZMAT_CLASSES.map((c) => (
            <Chip key={c} label={`Class ${c}`} selected={form.hazmatClasses.includes(c)} onPress={() => set('hazmatClasses', toggle(form.hazmatClasses, c))} testID={`hazmat-class-${c}`} />
          ))}
        </View>
      ) : null}
      {err('hazmat')}

      <Text style={styles.label}>Toll transponders you carry</Text>
      <View style={styles.wrap}>
        {NETWORKS.map((n) => (
          <Chip key={n} label={networkLabel(n)} selected={form.transponders.includes(n)} onPress={() => set('transponders', toggle(form.transponders, n))} testID={`transponder-${n}`} />
        ))}
      </View>

      <Text style={styles.label}>Home terminal (optional)</Text>
      {input('field-home', form.homeLabel, (v) => set('homeLabel', v), 'e.g. Port Newark', false)}
      {form.homeLabel.trim() !== '' ? (
        <View style={styles.row}>
          <Button
            label={form.homeCoords ? 'Location set ✓ — update to here' : 'Use my current location'}
            kind="secondary"
            disabled={!fix}
            onPress={() => fix && set('homeCoords', fix.location)}
            testID="home-use-location"
          />
        </View>
      ) : null}
      {err('home')}

      {saveError ? (
        <Text style={styles.error} testID="save-error">
          {saveError}
        </Text>
      ) : null}
      <View style={[styles.row, styles.actions]}>
        <Button label="Cancel" kind="secondary" onPress={onDone} />
        <Button label={saving ? 'Saving…' : 'Save'} disabled={saving} onPress={() => void save()} testID="save-profile" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  hint: { color: colors.muted, marginTop: space.sm, marginBottom: space.md },
  label: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: space.md, marginBottom: space.xs },
  input: { flex: 1, minHeight: 52, borderRadius: 10, backgroundColor: colors.surface, color: colors.text, fontSize: 18, paddingHorizontal: space.md, marginRight: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  error: { color: colors.danger, marginTop: space.xs },
  actions: { marginTop: space.lg },
  locked: { flex: 1, backgroundColor: colors.bg, padding: space.lg, justifyContent: 'center', gap: space.md },
  lockedText: { color: colors.text, fontSize: 18, textAlign: 'center' },
});
