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
 *
 * ## Das Bild ist ein eigenes Ziel, sobald eine Story dahinter liegt
 *
 * Zeile antippen öffnet das Profil, Bild antippen die Story. Das ist die Regel
 * der ganzen App (siehe `components/story-avatar.tsx`), und sie funktioniert nur,
 * wenn sie hier genauso gilt wie auf der Profilseite.
 *
 * Das Bild liegt dafür NEBEN der großen Tippfläche und nicht darin: Zwei
 * Pressables ineinander streiten sich um denselben Tipp – auf dem Handy gewinnt
 * das innere, im Web feuern je nach Aufbau beide, und dann öffnet ein Tipp die
 * Story und schiebt gleichzeitig das Profil darüber. Ohne Story bleibt das Bild
 * Teil der großen Fläche: Sonst wäre genau dort ein toter Fleck in einer Zeile,
 * die insgesamt aufs Profil führt.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { StoryAvatar } from '@/components/story-avatar';
import { ThemedText } from '@/components/themed-text';
import { GlassCard } from '@/components/ui/glass';
import { Spacing } from '@/constants/theme';
import { accountLabel } from '@/domain/account';
import { useBrandSurface } from '@/hooks/use-theme';
import type { PersonCard } from '@/lib/api';

/** Außendurchmesser des Bildes inklusive Story-Ring. */
const AVATAR = 48;

export function PersonRow({
  person,
  onPress,
  onOpenStory,
  action,
  /** Zusatzzeile statt Benutzername/Stufe – z. B. „blockiert seit …". */
  subtitle,
}: {
  person: PersonCard;
  onPress: () => void;
  /**
   * Tipp auf das Profilbild. Ohne diese Prop bleibt das Bild Teil der Zeile und
   * führt wie sie aufs Profil – in einer Liste blockierter Konten soll gar keine
   * Story aufgehen.
   */
  onOpenStory?: () => void;
  action?: React.ReactNode;
  subtitle?: string;
}) {
  const surface = useBrandSurface();

  const count = person.story?.count ?? 0;
  /** Nur ein eigenes Ziel, wenn es auch etwas zu öffnen gibt. */
  const storyTap = count > 0 && onOpenStory ? onOpenStory : null;

  const avatar = (
    <StoryAvatar
      size={AVATAR}
      avatar={person.avatar}
      name={person.name}
      stories={count}
      seen={!person.story?.unseen}
    />
  );

  return (
    <GlassCard tone="card" style={styles.row}>
      {storyTap ? (
        <Pressable
          onPress={storyTap}
          accessibilityRole="button"
          accessibilityLabel={
            `${count === 1 ? 'Story' : `${count} Storys`} von ${person.name} ansehen` +
            (person.story?.unseen ? '' : ', schon gesehen')
          }
          hitSlop={4}
          style={({ pressed }) => pressed && styles.pressed}>
          {avatar}
        </Pressable>
      ) : null}

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Profil von ${person.name}`}
        // Der antippbare Teil ist Bild + Text, nicht die ganze Zeile: Sonst läge
        // der Handlungsknopf rechts innerhalb einer größeren Trefferfläche und
        // beide stritten um denselben Tipp.
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        {storyTap ? null : avatar}
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
  pressed: { opacity: 0.7 },
});
