/**
 * Der Story-Betrachter: ein Bild auf schwarzem Grund, das von selbst weiterläuft.
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
import { remainingLabel } from '@/domain/story';
import type { Story } from '@/lib/api';

/** Wie lange eine Story steht. Aus der Praxis: unter 4 s hetzt, über 7 s langweilt. */
const STORY_MS = 5000;

export type StoryViewerProps = {
  stories: Story[];
  /** Bei welcher Story es losgeht; `null` = geschlossen. */
  startIndex: number | null;
  onClose: () => void;
  /** Wird für jede Story genau einmal gemeldet – der Screen schickt das zum Server. */
  onSeen: (story: Story) => void;
  /** Nur für eigene Storys angeboten. */
  onDelete?: (story: Story) => void;
};

export function StoryViewer({ stories, startIndex, onClose, onSeen, onDelete }: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(startIndex ?? 0);
  const progress = useSharedValue(0);

  /**
   * Welche Storys schon gemeldet sind.
   *
   * Als `Ref` und nicht als State: Ein State-Update würde den Screen neu rendern
   * und damit den laufenden Zeitgeber unten neu aufsetzen – die Story sprang dann
   * mitten im Ansehen zurück auf Anfang.
   */
  const reported = useRef<Set<number>>(new Set());

  const open = startIndex !== null;
  const story = stories[index] ?? null;

  // Beim Öffnen an die richtige Stelle springen. Ohne das stünde nach dem
  // zweiten Öffnen noch der Index vom letzten Mal.
  useEffect(() => {
    if (startIndex !== null) setIndex(startIndex);
  }, [startIndex]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) {
        // Vor der ersten Story gibt es nichts – dann bleibt sie einfach stehen,
        // statt den Betrachter zu schließen. Zurücktippen soll nie beenden.
        setIndex(0);
        return;
      }
      if (next >= stories.length) {
        onClose();
        return;
      }
      setIndex(next);
    },
    [stories.length, onClose],
  );

  // Gesehen melden – einmal pro Story und Sitzung.
  useEffect(() => {
    if (!open || !story) return;
    if (reported.current.has(story.id)) return;
    reported.current.add(story.id);
    onSeen(story);
  }, [open, story, onSeen]);

  // Zeitleiste + Weiterschalten. Hängt an `index`, läuft also bei jedem Wechsel neu.
  useEffect(() => {
    if (!open || !story) return;

    progress.value = 0;
    progress.value = withTiming(1, { duration: STORY_MS, easing: Easing.linear });

    const timer = setTimeout(() => goTo(index + 1), STORY_MS);
    return () => clearTimeout(timer);
  }, [open, story, index, goTo, progress]);

  // Beim Schließen zurücksetzen, damit die nächste Sitzung wieder alles meldet.
  useEffect(() => {
    if (!open) reported.current.clear();
  }, [open]);

  const bar = useAnimatedStyle(() => ({
    width: `${(reduced ? 1 : progress.value) * 100}%`,
  }));

  if (!open || !story) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.screen}>
        {story.image_url ? (
          // `contain` und nicht `cover`: Eine Story ist ein Bild, das jemand
          // aufgenommen hat – abgeschnitten wäre es ein anderes Bild.
          <Image source={{ uri: story.image_url }} style={styles.image} contentFit="contain" />
        ) : null}

        {/* Zeitleiste: ein Segment pro Story. */}
        <View style={[styles.bars, { top: insets.top + Spacing.two }]}>
          {stories.map((item, position) => (
            <View key={item.id} style={styles.barTrack}>
              {position < index ? (
                <View style={styles.barDone} />
              ) : position === index ? (
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
            onPress={() => goTo(index - 1)}
            accessibilityRole="button"
            accessibilityLabel="Vorherige Story"
          />
          <Pressable
            style={styles.tapRight}
            onPress={() => goTo(index + 1)}
            accessibilityRole="button"
            accessibilityLabel="Nächste Story"
          />
        </View>

        {/* Kopfzeile: wer, welche Stufe – und Schließen. Liegt NACH den
            Tippflächen, bekommt seine Tipps also zuverlässig zuerst. */}
        <View style={[styles.head, { top: insets.top + Spacing.four }]}>
          <View style={styles.headText}>
            <ThemedText style={styles.author} numberOfLines={1}>
              {story.is_mine ? 'Deine Story' : story.user.name}
            </ThemedText>
            <ThemedText style={styles.tier} numberOfLines={1}>
              {/* Stufe und Restzeit in einer Zeile. Die Restzeit erklärt, warum
                  die Story morgen weg ist – ohne sie wirkt das Verschwinden wie
                  ein Fehler. Fehlt sie (abgelaufen, kein Datum), bleibt die
                  Stufe allein stehen statt „noch 0 Min." zu behaupten. */}
              {[accountLabel(story.user.account_type), remainingLabel(story.expires_in_minutes)]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </View>

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
  image: { ...StyleSheet.absoluteFillObject },
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
  author: { color: '#ffffff', fontSize: 15, fontWeight: '700', fontFamily: FontFamily.bold },
  tier: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  headButton: { padding: Spacing.one },
  taps: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
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
