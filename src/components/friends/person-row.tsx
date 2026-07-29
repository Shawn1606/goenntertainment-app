/**
 * Eine Person als Zeile: Bild, Name, Stufe – und rechts, was man tun kann.
 *
 * Stand vorher als lokale Funktion in `src/app/(app)/friends.tsx`. Herausgelöst,
 * weil dieselbe Zeile inzwischen an vier Stellen gebraucht wird (Suchtreffer,
 * Anfragen, Freundesliste, blockierte Konten) und der Screen dadurch auf das
 * schrumpft, was er wirklich ist: die Steuerung dieser Listen.
 *
 * ## Die Handlung kommt von außen
 *
 * `action` ist ein Element und keine Aufzählung von Zuständen. Dieselbe Zeile
 * trägt in der Suche „Anfragen", bei den Anfragen „Annehmen/Ablehnen", in der
 * Freundesliste ein Kreuz und bei den blockierten Konten „Freigeben". Eine Zeile,
 * die alle vier Fälle selbst kennt, wächst mit jedem fünften – und muss dann
 * wissen, in welcher Liste sie steht.
 */
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassCard } from '@/components/ui/glass';
import { FontFamily, Spacing } from '@/constants/theme';
import { accountLabel } from '@/domain/account';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import type { PersonCard } from '@/lib/api';

/** Erste Buchstaben des Namens – Rückfallbild ohne Profilbild. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function PersonRow({
  person,
  onPress,
  action,
  /** Zusatzzeile statt Benutzername/Stufe – z. B. „blockiert seit …". */
  subtitle,
}: {
  person: PersonCard;
  onPress: () => void;
  action?: React.ReactNode;
  subtitle?: string;
}) {
  const surface = useBrandSurface();
  const glass = useGlass();

  return (
    <GlassCard tone="card" style={styles.row}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Profil von ${person.name}`}
        // Der antippbare Teil ist Bild + Text, nicht die ganze Zeile: Sonst läge
        // der Handlungsknopf rechts innerhalb einer größeren Trefferfläche und
        // beide stritten um denselben Tipp.
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        <View
          style={[
            styles.avatar,
            { backgroundColor: surface.chipBgSolid, borderColor: glass.border },
          ]}>
          {person.avatar ? (
            <Image source={{ uri: person.avatar }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <ThemedText style={[styles.initials, { color: surface.accent }]}>
              {initialsOf(person.name)}
            </ThemedText>
          )}
        </View>
        <View style={styles.rowText}>
          <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
            {person.name}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
            {subtitle ??
              [person.username ? `@${person.username}` : null, accountLabel(person.account_type)]
                .filter(Boolean)
                .join(' · ')}
          </ThemedText>
        </View>
      </Pressable>
      {action}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowText: { flex: 1, gap: 1 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  initials: { fontSize: 14, fontWeight: '800', fontFamily: FontFamily.bold },
  pressed: { opacity: 0.7 },
});
