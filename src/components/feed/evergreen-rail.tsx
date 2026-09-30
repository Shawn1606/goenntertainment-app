import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActivityPoster } from '@/components/feed/activity-poster';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing } from '@/constants/theme';
import { formatDistance } from '@/domain/distance';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

/**
 * „Jederzeit möglich" – Dauerangebote als Querleiste zwischen den Beiträgen.
 *
 * Warum sie überhaupt zwischen den Beiträgen stehen, steht in
 * `src/domain/feed-mix.ts`. Warum als Leiste und nicht als weitere Beiträge: Sie
 * sind etwas anderes. Ein Beitrag ist eine Verabredung mit Uhrzeit und Leuten;
 * ein Dauerangebot ist ein Ort, an den man jederzeit gehen kann. Sähen beide
 * gleich aus, würde man beim Bowling-Center nach der Uhrzeit suchen.
 */
function EvergreenRailImpl({
  activities,
  distanceById,
  onOpen,
}: {
  activities: Activity[];
  distanceById: Map<number, number>;
  onOpen: (activity: Activity) => void;
}) {
  const colors = useTheme();
  if (activities.length === 0) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.backgroundElement }]}>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: colors.background }]}>
          <Icon name="sparkles" size={16} color={colors.tint} />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.title, { color: colors.text }]}>Jederzeit möglich</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            Ohne festen Termin – einfach vorbeigehen
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + Spacing.two + 4}>
        {activities.map((activity) => {
          const distance = formatDistance(distanceById.get(activity.id) ?? null);
          return (
            <PressableScale
              key={activity.id}
              onPress={() => onOpen(activity)}
              haptic="tap"
              scaleTo={0.97}
              accessibilityRole="button"
              accessibilityLabel={`${activity.title} öffnen, jederzeit möglich`}
              style={[styles.card, { backgroundColor: colors.background, borderColor: colors.backgroundSelected }]}>
              <View style={styles.cardMedia}>
                <ActivityPoster activity={activity} iconSize={34} showTitle={false} />
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.45)']} style={styles.cardShade} pointerEvents="none" />
                {distance ? (
                  <View style={styles.distance}>
                    <Icon name="map-pin" size={11} color="#ffffff" />
                    <Text style={styles.distanceText}>{distance}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                  {activity.title}
                </Text>
                <Text style={[styles.cardSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {activity.location}
                </Text>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

export const EvergreenRail = memo(EvergreenRailImpl);

const CARD_WIDTH = 210;

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Spacing.two + 2,
    marginBottom: Spacing.four,
    borderRadius: Radius.panel + 2,
    paddingVertical: Spacing.three,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingHorizontal: Spacing.three, marginBottom: Spacing.three },
  headIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  title: { fontFamily: FontFamily.bold, fontSize: 16 },
  sub: { fontFamily: FontFamily.regular, fontSize: 12 },
  track: { paddingHorizontal: Spacing.three, gap: Spacing.two + 4 },
  card: {
    width: CARD_WIDTH,
    borderRadius: Radius.card + 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardMedia: { height: 124, overflow: 'hidden' },
  cardShade: { ...StyleSheet.absoluteFill },
  distance: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  distanceText: { color: '#ffffff', fontFamily: FontFamily.semibold, fontSize: 11 },
  cardBody: { padding: Spacing.two + 2, gap: 1 },
  cardTitle: { fontFamily: FontFamily.bold, fontSize: 14 },
  cardSub: { fontFamily: FontFamily.regular, fontSize: 12 },
});
