import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';

import { CategoryIcon } from '@/components/ui/category-icon';
import { FontFamily, Spacing } from '@/constants/theme';
import type { Activity } from '@/lib/api';

/**
 * Hintergründe für Aktivitäten ohne Foto. Aus der ersten Kategorie gewählt, damit
 * dieselbe Sorte Event immer gleich aussieht – ein Feed aus lauter identischen
 * Verläufen wäre eine Wand.
 */
const POSTER_GRADIENTS = [
  ['#fe2c55', '#dd2a7b', '#8134af'],
  ['#25f4ee', '#3b82f6', '#8134af'],
  ['#f58529', '#fe2c55', '#dd2a7b'],
  ['#10b981', '#06b6d4', '#3b82f6'],
  ['#8134af', '#515bd4', '#25f4ee'],
  ['#f59e0b', '#f97316', '#fe2c55'],
] as const;

export function posterGradient(activity: Pick<Activity, 'id' | 'interests'>) {
  const seed = activity.interests[0]?.id ?? activity.id;
  return POSTER_GRADIENTS[Math.abs(seed) % POSTER_GRADIENTS.length];
}

/**
 * Das Bild einer Aktivität – das Foto, oder ohne Foto ein Plakat im Verlauf mit
 * Kategorie-Symbol und Titel. Füllt seinen Rahmen (`absoluteFill`); die Größe
 * bestimmt der Aufrufer. Feed, Detail-Blatt und „Jederzeit"-Karten nutzen
 * dasselbe, damit eine Aktivität überall gleich aussieht.
 */
export function ActivityPoster({
  activity,
  iconSize = 56,
  titleSize = 26,
  showTitle = true,
}: {
  activity: Pick<Activity, 'id' | 'title' | 'banner_url' | 'interests'>;
  iconSize?: number;
  titleSize?: number;
  /** Ohne Foto den Titel aufs Plakat schreiben? Aus, wo er ohnehin daneben steht. */
  showTitle?: boolean;
}) {
  if (activity.banner_url) {
    return (
      <Image
        source={{ uri: activity.banner_url }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={180}
        accessible={false}
      />
    );
  }
  return (
    <LinearGradient
      colors={posterGradient(activity)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[StyleSheet.absoluteFill, styles.poster]}>
      <CategoryIcon interest={activity.interests[0]} size={iconSize} color="rgba(255,255,255,0.95)" />
      {showTitle ? (
        <Text style={[styles.title, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.22) }]} numberOfLines={3}>
          {activity.title}
        </Text>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  poster: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
  },
  title: {
    color: '#ffffff',
    fontFamily: FontFamily.bold,
    textAlign: 'center',
  },
});
