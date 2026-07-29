/**
 * Formular für eine Gruppe – zum Anlegen und zum Umbenennen.
 *
 * ## Ein Formular für beide Fälle
 *
 * Die Felder sind dieselben (Name, wer ist dabei), und beim Umbenennen fällt
 * lediglich die Mitglieder-Auswahl weg – Mitglieder verwaltet man danach an der
 * Karte. Zwei Formulare hätten zwei Prüfungen für denselben Namen.
 *
 * Der Unterschied steckt allein in `mode`: Er bestimmt die Überschrift und die
 * Beschriftung des Knopfes. Sonst nichts.
 *
 * ## Ohne eigenen Netz-Zugriff
 *
 * Das Formular sammelt nur und meldet `onSubmit`. Speichern, Fehler anzeigen und
 * die Liste neu laden macht der Screen – so gibt es einen Ort, an dem der
 * Fehlerfall behandelt wird, und nicht zwei.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassButton, GlassCard, GlassChip } from '@/components/ui/glass';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useBrandSurface } from '@/hooks/use-theme';
import type { PersonCard } from '@/lib/api';

/** Länge des Gruppennamens; gleiche Zahl wie Spalte und Server-Prüfung. */
const MAX_GROUP_NAME = 60;

export type GroupFormMode = 'create' | 'rename';

export function GroupForm({
  mode,
  initialName = '',
  friends,
  saving,
  onSubmit,
  onCancel,
}: {
  mode: GroupFormMode;
  initialName?: string;
  /** Bestätigte Freunde – nur beim Anlegen sichtbar. */
  friends: PersonCard[];
  saving: boolean;
  onSubmit: (name: string, members: number[]) => void;
  onCancel: () => void;
}) {
  const surface = useBrandSurface();
  const [name, setName] = useState(initialName);
  const [members, setMembers] = useState<number[]>([]);

  const creating = mode === 'create';

  return (
    <GlassCard tone="accent" radius={Radius.panel} style={styles.form}>
      <ThemedText type="smallBold" style={{ color: surface.text }}>
        {creating ? 'Neue Gruppe' : 'Gruppe umbenennen'}
      </ThemedText>

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="z. B. Kickerrunde"
        maxLength={MAX_GROUP_NAME}
        editable={!saving}
        autoFocus
      />

      {creating ? (
        friends.length > 0 ? (
          <View style={styles.pickWrap}>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Wer soll dabei sein? Du kannst später weitere aufnehmen.
            </ThemedText>
            <View style={styles.pickChips}>
              {friends.map((person) => (
                <GlassChip
                  key={person.id}
                  label={person.name}
                  selected={members.includes(person.id)}
                  onPress={() =>
                    setMembers((prev) =>
                      prev.includes(person.id)
                        ? prev.filter((id) => id !== person.id)
                        : [...prev, person.id],
                    )
                  }
                />
              ))}
            </View>
          </View>
        ) : (
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            In eine Gruppe kommen nur bestätigte Freunde – du kannst sie schon jetzt anlegen und
            später Leute aufnehmen.
          </ThemedText>
        )
      ) : null}

      <View style={styles.formActions}>
        <Pressable
          onPress={onCancel}
          disabled={saving}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={{ color: surface.textMuted }}>
            Abbrechen
          </ThemedText>
        </Pressable>
        <View style={styles.formSubmit}>
          <GlassButton
            title={
              saving
                ? 'Wird gespeichert …'
                : creating
                  ? 'Gruppe anlegen'
                  : 'Namen speichern'
            }
            variant="primary"
            disabled={saving}
            onPress={() => onSubmit(name.trim(), members)}
          />
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three, padding: Spacing.three },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  formSubmit: { flex: 1 },
  pickWrap: { gap: Spacing.two },
  pickChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pressed: { opacity: 0.7 },
});
