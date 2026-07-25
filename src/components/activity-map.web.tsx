import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { openRoute } from '@/lib/open-maps';
import { useMapActivities } from '@/lib/use-map-activities';

/**
 * Web-Variante: Eine echte, eingebettete Karte gibt es nur in der Handy-App
 * (react-native-maps läuft nicht im Browser). Hier zeigen wir die Aktivitäten
 * als Liste mit Route-Button – für den Web-Test völlig ausreichend.
 */
export default function MapScreenWeb() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { items, unlocated, loading, error } = useMapActivities(token);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.six, paddingBottom: insets.bottom + BottomTabInset + Spacing.four },
        ]}>
        <ThemedText type="subtitle">Karte</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.note}>
          Die interaktive Karte mit Pins läuft in der Handy-App. Hier siehst du die
          Aktivitäten als Liste – „Route anzeigen" öffnet Google Maps.
        </ThemedText>

        {loading && items.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={theme.tint} />
          </View>
        ) : null}

        {error ? (
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            {error}
          </ThemedText>
        ) : null}

        {items.map((activity) => (
          <View key={activity.id} style={styles.row}>
            <ActivityCard activity={activity} />
            <Pressable
              onPress={() => openRoute(activity.coords, activity.location || activity.title)}
              style={({ pressed }) => [
                styles.routeButton,
                { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText style={[styles.routeText, { color: theme.tintText }]}>
                Route anzeigen
              </ThemedText>
            </Pressable>
          </View>
        ))}

        {!loading && !error && items.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            Noch keine Aktivitäten mit Ort.
          </ThemedText>
        ) : null}

        {unlocated.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            {unlocated.length} Aktivität(en) ohne auffindbaren Ort werden nicht angezeigt.
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  note: {
    marginBottom: Spacing.two,
  },
  row: {
    gap: Spacing.two,
  },
  routeButton: {
    borderRadius: 16,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  routeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  empty: {
    paddingVertical: Spacing.six,
    alignItems: 'center',
    textAlign: 'center',
  },
});
