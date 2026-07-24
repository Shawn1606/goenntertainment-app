import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { BrandLogo } from '@/components/brand-logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACTIVITIES } from '@/constants/activities';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  personal: 'Persönlich',
  business: 'Business',
};

export default function HomeScreen() {
  const theme = useTheme();
  const safeAreaInsets = useSafeAreaInsets();
  const { user, logout } = useAuth();

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
          <View>
            {/* Kopf: Marke + Abmelden */}
            <View style={styles.topBar}>
              <BrandLogo size="small" />
              <Pressable
                onPress={logout}
                style={[styles.logout, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small">Abmelden</ThemedText>
              </Pressable>
            </View>

            {/* Begrüßungskarte mit echten Userdaten */}
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="subtitle">Hallo {user?.name ?? ''} 👋</ThemedText>
              {user?.username ? (
                <ThemedText themeColor="textSecondary">@{user.username}</ThemedText>
              ) : null}

              {user?.account_type ? (
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: theme.tint }]}>
                    <ThemedText type="small" style={{ color: theme.tintText }}>
                      {ACCOUNT_TYPE_LABELS[user.account_type] ?? user.account_type}
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {user?.interests && user.interests.length > 0 ? (
                <View style={styles.interests}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Deine Interessen
                  </ThemedText>
                  <View style={styles.chipRow}>
                    {user.interests.map((interest) => (
                      <View
                        key={interest.id}
                        style={[styles.chip, { borderColor: theme.backgroundSelected }]}>
                        <ThemedText type="small">{interest.name}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.listHeader}>
              <ThemedText themeColor="textSecondary">Entdecke Aktivitäten in deiner Nähe.</ThemedText>
            </View>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  logout: {
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  card: {
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.one,
    marginBottom: Spacing.four,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: Spacing.two,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  interests: {
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  listHeader: {
    marginBottom: Spacing.three,
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
