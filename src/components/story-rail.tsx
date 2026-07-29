/**
 * Die Story-Leiste unter der Fortschritts-Karte.
 *
 * ## Was hier vorgeschlagen wird
 *
 * Die Reihenfolge kommt vom Server (ungesehene zuerst, darin die neuesten) und
 * wird hier NICHT nachsortiert. Das ist Absicht: Würde die App zusätzlich
 * umsortieren, gäbe es zwei Wahrheiten darüber, was „vorgeschlagen" heißt – und
 * die Leiste sprang bei jedem Neuladen anders.
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
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { BrandGradient, FontFamily, Spacing } from '@/constants/theme';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import type { Story } from '@/lib/api';

/** Durchmesser des Rings – groß genug für ein erkennbares Gesicht, klein genug für sechs davon. */
const RING = 64;
const RING_PADDING = 2.5;

/** Erste Buchstaben des Namens – Rückfallbild ohne Profilbild (wie im Konto-Widget). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export type StoryRailProps = {
  stories: Story[];
  /** true = das eigene Konto darf Storys anlegen (ab Creator). */
  canPublish: boolean;
  /** Story antippen – der Betrachter gehört in den Screen, nicht hierher. */
  onOpen: (index: number) => void;
  /** Auf „Deine Story" tippen. */
  onCreate: () => void;
};

export function StoryRail({ stories, canPublish, onOpen, onCreate }: StoryRailProps) {
  // Ohne Storys UND ohne Recht zu veröffentlichen: gar keine Leiste. Ein leerer
  // Streifen mit einem Plus, das nichts darf, wäre eine Sackgasse.
  if (stories.length === 0 && !canPublish) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}>
      {canPublish ? <CreateBubble onPress={onCreate} /> : null}
      {stories.map((story, index) => (
        <StoryBubble key={story.id} story={story} onPress={() => onOpen(index)} />
      ))}
    </ScrollView>
  );
}

/** „Deine Story" – der Einstieg zum Anlegen. */
function CreateBubble({ onPress }: { onPress: () => void }) {
  const surface = useBrandSurface();
  const glass = useGlass();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Eigene Story anlegen"
      haptic="press"
      style={styles.bubble}>
      <View style={[styles.ring, { borderWidth: 2, borderColor: glass.border }]}>
        <View style={[styles.inner, { backgroundColor: surface.chipBgSolid }]}>
          <Icon name="plus" size={24} color={surface.accent} />
        </View>
      </View>
      <ThemedText type="small" style={[styles.name, { color: surface.textMuted }]} numberOfLines={1}>
        Deine Story
      </ThemedText>
    </PressableScale>
  );
}

function StoryBubble({ story, onPress }: { story: Story; onPress: () => void }) {
  const surface = useBrandSurface();
  const glass = useGlass();
  const label = story.is_mine ? 'Du' : story.user.name;

  const avatar = story.user.avatar ? (
    <Image source={{ uri: story.user.avatar }} style={styles.avatar} contentFit="cover" />
  ) : (
    // Ohne Profilbild das Story-Bild selbst: Es ist ohnehin das, was hinter dem
    // Ring steckt, und sagt mehr als zwei Buchstaben.
    story.image_url ? (
      <Image source={{ uri: story.image_url }} style={styles.avatar} contentFit="cover" />
    ) : (
      <ThemedText style={[styles.initials, { color: surface.accent }]}>
        {initialsOf(story.user.name)}
      </ThemedText>
    )
  );

  const body = (
    <View style={[styles.inner, { backgroundColor: surface.chipBgSolid }]}>{avatar}</View>
  );

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Story von ${label}${story.seen ? ', schon gesehen' : ''}`}
      haptic="tap"
      style={styles.bubble}>
      {story.seen ? (
        // Gesehen: nur eine Kontur. Der Verlauf ist das Signal für „neu" und darf
        // sich nicht abnutzen.
        <View style={[styles.ring, { borderWidth: 2, borderColor: glass.border }]}>{body}</View>
      ) : (
        <LinearGradient
          colors={[...BrandGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ring}>
          {body}
        </LinearGradient>
      )}
      <ThemedText
        type="small"
        style={[styles.name, { color: story.seen ? surface.textMuted : surface.text }]}
        numberOfLines={1}>
        {label}
      </ThemedText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  rail: { gap: Spacing.three, paddingHorizontal: Spacing.four, paddingVertical: Spacing.one },
  bubble: { alignItems: 'center', gap: Spacing.one, width: RING + 8 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    padding: RING_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    height: '100%',
    borderRadius: RING / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: { width: '100%', height: '100%' },
  initials: { fontSize: 17, fontWeight: '800', fontFamily: FontFamily.bold },
  name: { fontSize: 11, textAlign: 'center' },
});
