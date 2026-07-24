import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';

type Props = {
  activity: Activity;
  onPress?: () => void;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-Datum → „TT.MM.JJJJ, HH:MM" (ohne Intl, robust auf Hermes). */
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ActivityCard({ activity, onPress }: Props) {
  const theme = useTheme();
  const when = formatDate(activity.starts_at);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        {activity.banner_url ? (
          <Image source={{ uri: activity.banner_url }} style={styles.banner} resizeMode="cover" />
        ) : null}

        <View style={styles.body}>
          <ThemedText type="smallBold">{activity.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[when, activity.location].filter(Boolean).join(' · ')}
          </ThemedText>

          <View style={styles.footer}>
            <View style={styles.chips}>
              {activity.interests.slice(0, 3).map((interest) => (
                <ThemedView key={interest.id} type="backgroundSelected" style={styles.chip}>
                  <ThemedText type="small">{interest.name}</ThemedText>
                </ThemedView>
              ))}
            </View>

            {activity.host ? (
              <ThemedText type="small" themeColor="textSecondary" style={{ color: theme.tint }}>
                von {activity.host.name}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  banner: {
    width: '100%',
    height: 130,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    flexShrink: 1,
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
});
