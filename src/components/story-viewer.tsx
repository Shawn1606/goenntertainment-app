/**
 * Der Story-Betrachter: ein Bild auf schwarzem Grund, das von selbst weiterläuft.
 *
 * ## Gestaffelt: erst die Person zu Ende, dann die nächste
 *
 * Der Betrachter arbeitet auf GRUPPEN (eine je Person, siehe
 * `groupStories` in src/domain/story.ts), nicht auf einer flachen Liste. Ein Tipp
 * nach rechts blättert innerhalb der Person weiter und wechselt erst am Ende
 * ihrer Storys zur nächsten. Vorher war jede Story ein eigener Eintrag – der
 * zweite Tipp sprang damit zur nächsten Person, obwohl von der ersten noch etwas
 * kam.
 *
 * Die Zeitleiste oben zeigt deshalb nur die Storys der AKTUELLEN Person. Ein
 * Balken über alle Storys aller Leute wäre keine Auskunft mehr, sondern ein
 * Fortschrittsbalken über etwas, das niemand am Stück ansieht.
 *
 * Wohin ein Schritt führt, entscheidet `stepStory` – die Randfälle (Anfang,
 * Gruppenende, letzte Gruppe, leere Gruppe) sind dort geprüft.
 *
 * ## Warum hier ein `Modal` in Ordnung ist
 *
 * Die übrigen Blätter dieser App meiden `Modal`, weil `BlurView` nur weichzeichnen
 * kann, was in SEINEM Fenster liegt (siehe `account-widget.tsx`). Hier wird gar
 * nichts weichgezeichnet: Der Grund ist deckend schwarz. Ein `Modal` ist dann
 * sogar besser, weil es die native Tab-Leiste mit überdeckt – und eine Story, die
 * unten von einer Leiste angeschnitten wird, ist keine Vollbild-Story.
 *
 * ## Die Zeitleiste ist die eigentliche Arbeit
 *
 * Ein Balken pro Story, der aktuelle läuft. Ohne diese Leiste weiß niemand, wie
 * viele noch kommen oder wie lange die aktuelle noch steht – und tippt aus Unsicher-
 * heit weiter, statt zuzusehen. Der Balken läuft mit `withTiming` auf 100 % und
 * startet bei jedem Wechsel neu; ist er durch, schaltet ein Zeitgeber weiter.
 * Beides getrennt zu halten (Anzeige in Reanimated, Weiterschalten in JS) ist
 * Absicht: Ein Callback aus dem Animationslauf zurück nach JS wäre die eine
 * Stelle, an der so etwas auf Android gelegentlich verschluckt wird.
 */
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { accountLabel } from '@/domain/account';
import { firstUnseenIndex, remainingLabel, stepStory, type StoryGroup } from '@/domain/story';
import type { Story } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { apiImageSource } from '@/lib/auth-image';

/** Wie lange eine Story steht. Aus der Praxis: unter 4 s hetzt, über 7 s langweilt. */
const STORY_MS = 5000;

export type StoryViewerProps = {
  /** Gebündelt nach Person – dieselbe Liste wie in der Leiste. */
  groups: StoryGroup<Story>[];
  /** Bei welcher PERSON es losgeht; `null` = geschlossen. */
  startGroup: number | null;
  onClose: () => void;
  /** Wird für jede Story genau einmal gemeldet – der Screen schickt das zum Server. */
  onSeen: (story: Story) => void;
  /** Nur für eigene Storys angeboten. */
  onDelete?: (story: Story) => void;
  /** Tipp auf den Namen: führt aufs Profil. Ohne diese Prop bleibt er Text. */
  onOpenProfile?: (story: Story) => void;
};

export function StoryViewer({
  groups,
  startGroup,
  onClose,
  onSeen,
  onDelete,
  onOpenProfile,
}: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // Story images are private (F-11): the server shows them only with the viewer's token.
  const { token } = useAuth();
  /** Wo wir gerade stehen: welche Person, welche ihrer Storys. */
  const [at, setAt] = useState({ group: startGroup ?? 0, story: 0 });
  const progress = useSharedValue(0);

  /**
   * Welche Storys schon gemeldet sind.
   *
   * Als `Ref` und nicht als State: Ein State-Update würde den Screen neu rendern
   * und damit den laufenden Zeitgeber unten neu aufsetzen – die Story sprang dann
   * mitten im Ansehen zurück auf Anfang.
   */
  const reported = useRef<Set<number>>(new Set());

  const open = startGroup !== null;
  const group = groups[at.group] ?? null;
  const story = group?.stories[at.story] ?? null;

  /**
   * Beim Öffnen an die richtige Stelle springen: erste Person, erste UNGESEHENE
   * Story. Ohne das stünde nach dem zweiten Öffnen noch die Stelle vom letzten
   * Mal – und man begänne mitten in etwas, das man schon kennt.
   */
  // Done while rendering, not in an effect (react.dev: "Adjusting some state when
  // a prop changes"), so the first committed frame already shows the right
  // story. Only a change of `startGroup` triggers it; `groups` is read but is
  // deliberately not part of the condition:
  // Die Liste ändert sich bei jedem „gesehen"-Update, und der Betrachter
  // spränge dann mitten im Ansehen zurück an den Anfang.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  if (startGroup !== openedAt) {
    setOpenedAt(startGroup);
    if (startGroup !== null) {
      const target = groups[startGroup];
      setAt({ group: startGroup, story: target ? firstUnseenIndex(target) : 0 });
    }
  }

  const goTo = useCallback(
    (direction: 1 | -1) => {
      const next = stepStory(groups, at, direction);
      if (!next) {
        // Nach der letzten Story der letzten Person ist Schluss. Zurücktippen
        // gibt nie `null` zurück – Zurück soll nie beenden.
        onClose();
        return;
      }
      setAt(next);
    },
    [groups, at, onClose],
  );

  // Gesehen melden – einmal pro Story und Sitzung.
  useEffect(() => {
    if (!open || !story) return;
    if (reported.current.has(story.id)) return;
    reported.current.add(story.id);
    onSeen(story);
  }, [open, story, onSeen]);

  // Zeitleiste + Weiterschalten. Hängt an der Position, läuft also bei jedem
  // Wechsel neu.
  useEffect(() => {
    if (!open || !story) return;

    progress.value = 0;
    progress.value = withTiming(1, { duration: STORY_MS, easing: Easing.linear });

    const timer = setTimeout(() => goTo(1), STORY_MS);
    return () => clearTimeout(timer);
  }, [open, story, goTo, progress]);

  // Beim Schließen zurücksetzen, damit die nächste Sitzung wieder alles meldet.
  useEffect(() => {
    if (!open) reported.current.clear();
  }, [open]);

  const bar = useAnimatedStyle(() => ({
    width: `${(reduced ? 1 : progress.value) * 100}%`,
  }));

  if (!open || !group || !story) return null;

  const profileLink = onOpenProfile && story.user.username ? () => onOpenProfile(story) : undefined;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen}>
        {story.image_url ? (
          // `contain` und nicht `cover`: Eine Story ist ein Bild, das jemand
          // aufgenommen hat – abgeschnitten wäre es ein anderes Bild.
          <Image source={apiImageSource(story.image_url, token)} style={styles.image} contentFit="contain" cachePolicy="memory" />
        ) : null}

        {/* Zeitleiste: ein Segment pro Story DIESER Person. */}
        <View style={[styles.bars, { top: insets.top + Spacing.two }]}>
          {group.stories.map((item, position) => (
            <View key={item.id} style={styles.barTrack}>
              {position < at.story ? (
                <View style={styles.barDone} />
              ) : position === at.story ? (
                <Animated.View style={[styles.barDone, bar]} />
              ) : null}
            </View>
          ))}
        </View>

        {/* Die zwei Tippflächen zum Blättern.
            Sie stehen ZUERST im Baum und liegen damit hinter allem, was danach
            kommt. Vorher lagen sie zuletzt und wurden per `zIndex` unter die
            Kopfzeile geschoben – das ist genau die Sorte Verlass, die auf Android
            bricht: Fürs Zeichnen wird `zIndex` beachtet, für die Auswertung von
            Berührungen aber nicht durchgängig. Der Schließen-Knopf lag dann
            sichtbar oben, bekam den Tipp aber nicht. Reihenfolge im Baum ist die
            Regel, die überall gilt. */}
        <View style={styles.taps} pointerEvents="box-none">
          <Pressable
            style={styles.tapLeft}
            onPress={() => goTo(-1)}
            accessibilityRole="button"
            accessibilityLabel="Vorherige Story"
          />
          <Pressable
            style={styles.tapRight}
            onPress={() => goTo(1)}
            accessibilityRole="button"
            accessibilityLabel="Nächste Story"
          />
        </View>

        {/* Kopfzeile: wer, welche Stufe – und Schließen. Liegt NACH den
            Tippflächen, bekommt seine Tipps also zuverlässig zuerst. */}
        <View style={[styles.head, { top: insets.top + Spacing.four }]}>
          {/* Der Name führt aufs Profil. Genau dafür ist der Ring da: Man sieht
              etwas Kurzes von jemandem und will dann sehen, wer das ist. */}
          <Pressable
            onPress={profileLink}
            disabled={!profileLink}
            accessibilityRole={profileLink ? 'link' : 'text'}
            accessibilityLabel={
              profileLink ? `Profil von ${story.user.name} öffnen` : story.user.name
            }
            hitSlop={6}
            style={({ pressed }) => [styles.headText, pressed && styles.pressed]}>
            <View style={styles.authorRow}>
              {story.user.avatar ? (
                <Image source={{ uri: story.user.avatar }} style={styles.headAvatar} contentFit="cover" />
              ) : null}
              <ThemedText style={styles.author} numberOfLines={1}>
                {story.is_mine ? 'Deine Story' : story.user.name}
                {profileLink ? ' ›' : ''}
              </ThemedText>
            </View>
            <ThemedText style={styles.tier} numberOfLines={1}>
              {/* Stufe, Position in der Reihe und Restzeit. Die Restzeit erklärt,
                  warum die Story morgen weg ist – ohne sie wirkt das
                  Verschwinden wie ein Fehler. Fehlt sie (abgelaufen, kein
                  Datum), bleibt der Rest stehen statt „noch 0 Min." zu
                  behaupten. */}
              {[
                accountLabel(story.user.account_type),
                group.stories.length > 1 ? `${at.story + 1}/${group.stories.length}` : null,
                remainingLabel(story.expires_in_minutes),
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </Pressable>

          {story.is_mine && onDelete ? (
            <Pressable
              onPress={() => onDelete(story)}
              accessibilityRole="button"
              accessibilityLabel="Story löschen"
              hitSlop={10}
              style={styles.headButton}>
              <Icon name="trash" size={20} color="#ffffff" />
            </Pressable>
          ) : null}

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Story schließen"
            hitSlop={10}
            style={styles.headButton}>
            <Icon name="close" size={20} color="#ffffff" />
          </Pressable>
        </View>

        {/* Die Unterschrift fängt KEINE Tipps ab: Sie deckt das untere Drittel der
            Breite ab, und dort will man weiterblättern. Ohne `pointerEvents: none`
            ist genau diese Fläche tot. */}
        {story.caption ? (
          <View
            pointerEvents="none"
            style={[styles.captionWrap, { bottom: insets.bottom + Spacing.five }]}>
            <ThemedText style={styles.caption}>{story.caption}</ThemedText>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Schwarz und nicht aus dem Thema: Ein Bild im Vollbild braucht neutrale
  // Umgebung, sonst färbt der Rand die Wahrnehmung der Farben im Bild.
  screen: { flex: 1, backgroundColor: '#000000' },
  image: { ...StyleSheet.absoluteFill },
  bars: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: 'row',
    gap: 3,
  },
  barTrack: {
    flex: 1,
    height: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  barDone: { height: '100%', borderRadius: 3, backgroundColor: '#ffffff' },
  // Kein `zIndex` mehr: Die Reihenfolge im Baum entscheidet – siehe die Notiz an
  // den Tippflächen im Aufbau oben.
  head: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headText: { flex: 1 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headAvatar: { width: 26, height: 26, borderRadius: 13 },
  author: { flexShrink: 1, color: '#ffffff', fontSize: 15, fontWeight: '700', fontFamily: FontFamily.bold },
  tier: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  headButton: { padding: Spacing.one },
  pressed: { opacity: 0.7 },
  taps: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  // Ein Drittel zurück, zwei Drittel weiter: Weiterblättern ist die Handlung,
  // die man dauernd macht, Zurück die Ausnahme.
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  captionWrap: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  caption: { color: '#ffffff', fontSize: 15, lineHeight: 21 },
});
