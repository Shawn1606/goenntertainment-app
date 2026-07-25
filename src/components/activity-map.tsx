import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/activity-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { openRoute } from '@/lib/open-maps';
import { type MapActivity, useMapActivities } from '@/lib/use-map-activities';

// Grober Startausschnitt (Deutschland), bis echte Pins geladen sind.
const DEFAULT_REGION: Region = {
  latitude: 51.1657,
  longitude: 10.4515,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { items, loading, error } = useMapActivities(token);

  const mapRef = useRef<MapView>(null);
  const [selected, setSelected] = useState<MapActivity | null>(null);

  // Sobald Pins da sind, den Kartenausschnitt darauf einpassen.
  useEffect(() => {
    if (items.length === 0) return;
    const coords = items.map((a) => ({ latitude: a.coords.lat, longitude: a.coords.lng }));
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 80, bottom: 240, left: 80 },
      animated: true,
    });
  }, [items]);

  // Falls die ausgewählte Activity aus der Liste fällt: Karte schließen.
  useEffect(() => {
    if (selected && !items.some((a) => a.id === selected.id)) {
      setSelected(null);
    }
  }, [items, selected]);

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        onPress={() => setSelected(null)}>
        {items.map((activity) => (
          <Marker
            key={activity.id}
            coordinate={{ latitude: activity.coords.lat, longitude: activity.coords.lng }}
            title={activity.title}
            description={activity.location}
            pinColor={theme.tint}
            onPress={(e) => {
              // Verhindert, dass onPress der Karte gleich wieder schließt.
              e.stopPropagation();
              setSelected(activity);
            }}
          />
        ))}
      </MapView>

      {/* Kopf-Hinweis */}
      <View style={[styles.header, { top: insets.top + Spacing.two }]} pointerEvents="none">
        <View style={[styles.headerPill, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">Aktivitäten in der Nähe</ThemedText>
        </View>
      </View>

      {/* Lade-/Fehleranzeige */}
      {loading && items.length === 0 ? (
        <View style={[styles.center, { top: insets.top }]} pointerEvents="none">
          <View style={[styles.headerPill, { backgroundColor: theme.backgroundElement }]}>
            <ActivityIndicator color={theme.tint} />
          </View>
        </View>
      ) : null}
      {!loading && error ? (
        <View style={[styles.center, { top: insets.top }]} pointerEvents="none">
          <View style={[styles.headerPill, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
          </View>
        </View>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <View style={[styles.center, { top: insets.top }]} pointerEvents="none">
          <View style={[styles.headerPill, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary">Noch keine Aktivitäten mit Ort.</ThemedText>
          </View>
        </View>
      ) : null}

      {/* Ausgewählte Activity als Karte unten + Route-Button */}
      {selected ? (
        <View
          style={[
            styles.sheet,
            { bottom: insets.bottom + BottomTabInset + Spacing.three },
          ]}>
          <ActivityCard activity={selected} />
          <Pressable
            onPress={() => openRoute(selected.coords, selected.location || selected.title)}
            style={({ pressed }) => [
              styles.routeButton,
              { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
            ]}>
            <ThemedText style={[styles.routeText, { color: theme.tintText }]}>
              Route anzeigen
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sheet: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    gap: Spacing.two,
  },
  routeButton: {
    borderRadius: 16,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  routeText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
