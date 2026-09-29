/**
 * Die Story-Leiste unter der Fortschritts-Karte.
 *
 * ## Ein Ring pro PERSON, nicht pro Story
 *
 * Das war vorher andersherum, und es war der Hauptfehler dieser Leiste: Wer drei
 * Bilder hochlud, stand dreimal darin, und der Betrachter sprang beim
 * Weitertippen zur nächsten Person statt zum nächsten eigenen Bild. Bei wenigen
 * aktiven Konten bestand die Leiste damit nur aus Wiederholungen desselben
 * Gesichts.
 *
 * Gebündelt wird in `src/domain/story.ts` (dort getestet) – diese Datei stellt
 * nur dar. Die Reihenfolge der Gruppen kommt weiterhin vom Server und wird hier
 * NICHT nachsortiert: Zwei Sortierungen an zwei Orten sind eine, die irgendwann
 * anders ist als die andere.
 *
 * ## Die eigene Story steht vorn und ist derselbe Ring
 *
 * Hat man selbst etwas veröffentlicht, ist „Deine Story" kein leeres Plus mehr,
 * sondern der eigene Ring mit einem kleinen ＋ daran: Der Ring öffnet, was man
 * gepostet hat, das ＋ legt Neues an. Vorher standen beide getrennt nebeneinander
 * – man sah sein eigenes Bild also zweimal und wusste nicht, welches der beiden
 * das Anlegen war.
 *
 * ## Warum Ring und nicht Karte
 *
 * Ein Ring um ein Profilbild ist die eine Form, die überall dasselbe bedeutet:
 * „hier ist etwas Kurzes, Neues, von dieser Person". Eine Karte würde mit den
 * Event-Karten darunter konkurrieren, und die tragen den eigentlichen Inhalt
 * dieser App.
 *
 * Ungesehen = Marken-Verlauf. Gesehen = ruhige Kontur. Der Unterschied ist der
 * einzige Zustand, den die Leiste kennt, und er muss ohne Text lesbar sein.
 *
 * ## Wie der Ring aussieht, steht nicht mehr hier
 *
 * Strichbreite, Bögen je Story und Verlauf wohnen in
 * `components/story-avatar.tsx`. Denselben Ring tragen inzwischen auch die
 * Profilseite und die Personenzeilen im Freunde-Bereich – und ein Zeichen, das an
 * drei Stellen nachgebaut ist, sieht nach dem zweiten Nachbau verschieden aus.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { StoryAvatar } from '@/components/story-avatar';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Spacing } from '@/constants/theme';
import type { StoryGroup } from '@/domain/story';
import { useBrandSurface, useTheme } from '@/hooks/use-theme';
import type { Story } from '@/lib/api';

/**
 * Durchmesser des Rings – groß genug für ein erkennbares Gesicht, klein genug
 * für sechs davon.
 *
 * Zwei Punkte mehr als früher, weil der Ring selbst breiter geworden ist und
 * INNEN liegt: Ohne die zwei Punkte hätte das Gesicht verloren, was der Ring
 * gewonnen hat.
 */
const RING = 66;

export type StoryRailProps = {
  /** Gebündelt nach Person – siehe `groupStories` in src/domain/story.ts. */
  groups: StoryGroup<Story>[];
  /** true = das eigene Konto darf Storys anlegen (ab Creator). */
  canPublish: boolean;
  /** Gruppe antippen – der Betrachter gehört in den Screen, nicht hierher. */
  onOpen: (groupIndex: number) => void;
  /** Auf „Deine Story" bzw. das ＋ tippen. */
  onCreate: () => void;
};

export function StoryRail({ groups, canPublish, onOpen, onCreate }: StoryRailProps) {
  // Ohne Storys UND ohne Recht zu veröffentlichen: gar keine Leiste. Ein leerer
  // Streifen mit einem Plus, das nichts darf, wäre eine Sackgasse.
  if (groups.length === 0 && !canPublish) return null;

  // Die eigene Gruppe nach vorn – aber nur die Anzeige wird umsortiert, die
  // Indizes bleiben die der übergebenen Liste (der Betrachter arbeitet damit).
  const mine = groups.findIndex((group) => group.isMine);
  const order = mine === -1 ? groups.map((_, i) => i) : [mine, ...groups.map((_, i) => i).filter((i) => i !== mine)];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}>
      {/* Nur wenn man selbst noch nichts stehen hat – sonst hängt das ＋ am
          eigenen Ring und es gäbe zwei Wege für dieselbe Sache. */}
      {canPublish && mine === -1 ? <CreateBubble onPress={onCreate} /> : null}

      {order.map((index) => (
        <StoryBubble
          key={groups[index].key}
          group={groups[index]}
          onPress={() => onOpen(index)}
          onCreate={groups[index].isMine && canPublish ? onCreate : undefined}
        />
      ))}
    </ScrollView>
  );
}

/**
 * „Deine Story" – der Einstieg zum Anlegen, solange man noch keine hat.
 *
 * Bewusst OHNE Ring (`stories={0}`): Der Ring sagt „hier liegt etwas", und hier
 * liegt noch nichts. Was hier liegt, ist eine Einladung, und die trägt das ＋.
 */
function CreateBubble({ onPress }: { onPress: () => void }) {
  const surface = useBrandSurface();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Eigene Story anlegen"
      haptic="press"
      style={styles.bubble}>
      <StoryAvatar size={RING} name="" stories={0}>
        <Icon name="plus" size={24} color={surface.accent} />
      </StoryAvatar>
      <ThemedText type="small" style={[styles.name, { color: surface.textMuted }]} numberOfLines={1}>
        Deine Story
      </ThemedText>
    </PressableScale>
  );
}

function StoryBubble({
  group,
  onPress,
  onCreate,
}: {
  group: StoryGroup<Story>;
  onPress: () => void;
  /** Nur an der eigenen Gruppe: das kleine ＋ zum Nachlegen. */
  onCreate?: () => void;
}) {
  const surface = useBrandSurface();
  // Die Kontur der Plakette läuft in Leinwandfarbe – so löst sie sich sichtbar
  // vom Ring, statt auf ihm zu kleben.
  const canvas = useTheme().background;
  const label = group.isMine ? 'Deine Story' : group.user.name;
  const count = group.stories.length;
  const cover = group.stories.find((story) => !story.seen) ?? group.stories[0];

  return (
    <View style={styles.bubble}>
      <View>
        <PressableScale
          onPress={onPress}
          accessibilityRole="button"
          // „3 Storys von Deine Story" wäre das Ergebnis, wenn man `label`
          // einsetzt – bei sich selbst heißt es deshalb „deine".
          accessibilityLabel={
            `${count === 1 ? 'Story' : `${count} Storys`} von ${group.isMine ? 'dir' : group.user.name}` +
            (group.seen ? ', schon gesehen' : '')
          }
          haptic="tap">
          <StoryAvatar
            size={RING}
            avatar={group.user.avatar}
            name={group.user.name}
            stories={count}
            seen={group.seen}
            // Ohne Profilbild das Story-Bild selbst: Es ist ohnehin das, was
            // hinter dem Ring steckt, und sagt mehr als zwei Buchstaben.
            fallbackImage={cover?.image_url}
          />
        </PressableScale>

        {/* Wie viele es sind. Nur ab zwei: Bei einer einzelnen Story wäre die 1
            eine Zahl ohne Aussage – und genau die Zahlen machen eine Leiste
            unruhig, die ruhig sein soll. Die Bögen des Rings zeigen die Anzahl
            inzwischen mit; die Plakette bleibt, weil sie ab zehn Storys die
            genaue Zahl nennt, die der Ring dann deckelt. */}
        {count > 1 && !onCreate ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: surface.accent, borderColor: canvas },
            ]}>
            <ThemedText style={[styles.badgeText, { color: surface.accentText }]}>{count}</ThemedText>
          </View>
        ) : null}

        {/* Das ＋ an der eigenen Gruppe. Eigener Tippbereich, damit der Ring
            weiter das Ansehen öffnet – zwei Ziele auf einer Fläche wären ein
            Ratespiel. */}
        {onCreate ? (
          <Pressable
            onPress={onCreate}
            accessibilityRole="button"
            accessibilityLabel="Weitere Story anlegen"
            hitSlop={8}
            style={({ pressed }) => [
              styles.badge,
              styles.addBadge,
              { backgroundColor: surface.accent, borderColor: canvas },
              pressed && styles.pressed,
            ]}>
            <Icon name="plus" size={13} color={surface.accentText} />
          </Pressable>
        ) : null}
      </View>

      <ThemedText
        type="small"
        style={[styles.name, { color: group.seen ? surface.textMuted : surface.text }]}
        numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.one },
  bubble: { alignItems: 'center', gap: Spacing.one, width: RING + 8 },
  name: { fontSize: 11, textAlign: 'center' },
  /** Zahl bzw. ＋ unten rechts am Ring – mit Kontur in Hintergrundfarbe, damit
      es sich sichtbar vom Ring löst statt auf ihm zu kleben. */
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBadge: { width: 22, height: 22, borderRadius: 11, paddingHorizontal: 0 },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '800', fontFamily: FontFamily.bold },
  pressed: { opacity: 0.7 },
});
