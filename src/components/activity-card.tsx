import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Activity } from '@/constants/activities';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  activity: Activity;
  onPress?: () => void;
};

export function ActivityCard({ activity, onPress }: Props) {
  const theme = useTheme();
  const full = activity.participants >= activity.maxParticipants;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.header}>
          <ThemedText style={styles.emoji}>{activity.emoji}</ThemedText>
          <View style={styles.headerText}>
            <ThemedText type="smallBold">{activity.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {activity.date} · {activity.location}
            </ThemedText>
          </View>
        </View>

        <View style={styles.footer}>
          <ThemedView type="backgroundSelected" style={styles.chip}>
            <ThemedText type="small">{activity.category}</ThemedText>
          </ThemedView>

          <ThemedText
            type="small"
            themeColor={full ? 'textSecondary' : 'text'}
            style={{ color: full ? theme.textSecondary : theme.tint }}>
            {full ? 'Voll' : `${activity.participants}/${activity.maxParticipants} dabei`}
          </ThemedText>
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
    padding: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 32,
    lineHeight: 40,
  },
  headerText: {
    flex: 1,
    gap: Spacing.half,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
});
