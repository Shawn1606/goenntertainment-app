import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { ActivityListSheet } from '@/components/activity-list-sheet';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { TabMascot } from '@/components/tab-mascot';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { formatDayTimeShort } from '@/domain/date-format';
import { groupByPlace, type PlaceGroup } from '@/domain/place-group';
import { useBrandSurface, useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { openRoute } from '@/lib/open-maps';
import { type MapActivity, useMapActivities } from '@/lib/use-map-activities';

/**
 * Web-Variante: Eine echte, eingebettete Karte gibt es nur in der Handy-App
 * (react-native-maps läuft nicht im Browser). Hier zeigen wir die Aktivitäten
 * als Liste mit Route-Button – für den Web-Test völlig ausreichend.
 */
export default function MapScreenWeb() {
  const theme = useTheme();
  const surface = useBrandSurface();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { items, unlocated, loading, error } = useMapActivities(token);

  // Dieselbe Gruppierung wie am Gerät: Ein Ort ist ein Eintrag, nicht ein Termin.
  // Sonst zeigte der Web-Test 143 Zeilen, wo die App einen Pin zeigt – und dann
  // prüft man hier etwas anderes, als man ausliefert.
  const places = useMemo(() => groupByPlace(items), [items]);
  const [place, setPlace] = useState<PlaceGroup<MapActivity> | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);

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
          Orte als Liste – „Route anzeigen“ öffnet Google Maps.
        </ThemedText>
        {/* Dieselbe Stimmung wie in der Handy-Variante – die Figur soll auf dem
            Karten-Tab nicht davon abhängen, welche Plattform gerade läuft. */}
        <TabMascot tab="map" />

        {loading && items.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={theme.tint} />
          </View>
        ) : null}

        {error ? <MascotError detail={error} /> : null}

        {places.map((group) => (
          <View key={group.key} style={styles.row}>
            <Pressable
              onPress={() =>
                group.activities.length === 1 ? setSelected(group.activities[0]) : setPlace(group)
              }
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.placeCard,
                {
                  backgroundColor: surface.card,
                  borderColor: surface.cardBorder,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}>
              <ThemedText style={[styles.placeTitle, { color: surface.text }]} numberOfLines={2}>
                {group.location}
              </ThemedText>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {group.activities.length === 1
                  ? group.activities[0].title
                  : `${group.activities.length} Termine`}
                {' · nächster '}
                {formatDayTimeShort(group.activities[0].starts_at)}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => openRoute(group.coords, group.location || group.activities[0].title)}
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

        {!loading && !error && places.length === 0 ? (
          <MascotEmpty mood="asleep" size={80} color={theme.tint} style={styles.empty}>
            <ThemedText themeColor="textSecondary">Noch keine Aktivitäten mit Ort.</ThemedText>
          </MascotEmpty>
        ) : null}

        {unlocated.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            {unlocated.length} Aktivität(en) ohne auffindbaren Ort werden nicht angezeigt.
          </ThemedText>
        ) : null}
      </ScrollView>

      <ActivityListSheet
        title={place ? place.location : null}
        subtitle={
          place
            ? `${place.activities.length} Termine · nächster ${formatDayTimeShort(place.activities[0].starts_at)}`
            : undefined
        }
        icon="map-pin"
        activities={place?.activities ?? []}
        onSelect={setSelected}
        onClose={() => setPlace(null)}
      />

      <ActivityDetailModal activity={selected} onClose={() => setSelected(null)} />
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
  /** Ein Ort als Zeile – im Web steht die Auswahl des Ortes vor der des Termins. */
  placeCard: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: Spacing.three,
    gap: 2,
  },
  placeTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
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
