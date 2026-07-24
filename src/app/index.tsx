import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITIES } from '@/constants/activities';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const theme = useTheme();
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={ACTIVITIES}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeAreaInsets.top + Spacing.four,
            paddingBottom: safeAreaInsets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="small" themeColor="textSecondary">
              Willkommen bei
            </ThemedText>
            <ThemedText type="subtitle">Gönntertainment</ThemedText>
            <ThemedText themeColor="textSecondary">
              Entdecke Aktivitäten in deiner Nähe.
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => <ActivityCard activity={item} />}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
      />

      <Pressable
        style={[
          styles.fab,
          {
            backgroundColor: theme.tint,
            bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
          },
        ]}>
        <ThemedText style={[styles.fabText, { color: theme.tintText }]}>＋</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: Spacing.half,
    marginBottom: Spacing.four,
  },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 4 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  fabText: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '600',
  },
});
