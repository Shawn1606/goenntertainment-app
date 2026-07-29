import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { Mascot, MascotEmpty, MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { reactionFor } from '@/domain/mascot-mood';
import { useBrandSurface, useTheme } from '@/hooks/use-theme';
import { type Activity } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { openRoute } from '@/lib/open-maps';
import { type MapActivity, useMapActivities } from '@/lib/use-map-activities';

// Grober Startausschnitt (Deutschland), bis der Standort da ist.
const DEFAULT_REGION: Region = {
  latitude: 51.1657,
  longitude: 10.4515,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

// Wie weit die Karte um den eigenen Standort herum zeigt (Radius in km).
const RADIUS_KM = 5;

type LatLng = { latitude: number; longitude: number };

// Baut einen Kartenausschnitt, der ~radiusKm um den Punkt herum zeigt.
function regionAround(c: LatLng, radiusKm: number): Region {
  const latitudeDelta = (radiusKm * 2) / 111.32; // 1° Breite ≈ 111,32 km
  const longitudeDelta =
    (radiusKm * 2) / (111.32 * Math.max(0.1, Math.cos((c.latitude * Math.PI) / 180)));
  return { latitude: c.latitude, longitude: c.longitude, latitudeDelta, longitudeDelta };
}

export default function MapScreen() {
  const theme = useTheme();
  const surface = useBrandSurface();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { items, loading, error } = useMapActivities(token);

  // Hinweis-Pillen tragen dasselbe Blau wie die Kategorie-Kacheln – hier in der
  // deckenden Variante, weil sie über den Kartenkacheln liegen.
  const pillStyle = { backgroundColor: surface.chipBgSolid, borderColor: surface.chipBorder };

  const mapRef = useRef<MapView>(null);
  const didCenter = useRef(false);
  const [selected, setSelected] = useState<MapActivity | null>(null);
  const [showUser, setShowUser] = useState(false);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);

  // Standort-Berechtigung beim Öffnen anfragen und Position holen – erst dann
  // zeigt die Karte den blauen „Ich bin hier"-Punkt.
  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      const granted = status === 'granted';
      setShowUser(granted);
      if (!granted) return;
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (active) {
          setUserCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }
      } catch {
        // Position gerade nicht verfügbar – kein Problem.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Karte auf den eigenen Standort zentrieren (fragt bei Bedarf erneut nach).
  const centerOnUser = useCallback(async () => {
    try {
      let granted = showUser;
      if (!granted) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        granted = status === 'granted';
        setShowUser(granted);
      }
      if (!granted) return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setUserCoords(here);
      mapRef.current?.animateToRegion(regionAround(here, RADIUS_KM), 500);
    } catch {
      // Standort nicht verfügbar – still ignorieren.
    }
  }, [showUser]);

  // Route zur ausgewählten Activity in Google/Apple Maps öffnen.
  const handleRoute = useCallback(() => {
    if (selected) openRoute(selected.coords, selected.location || selected.title);
  }, [selected]);

  // Nach Beitreten/Verlassen: die offene Auswahl mit den frischen Daten
  // aktualisieren (Koordinaten behalten). Die Marker selbst zeigen keine
  // Teilnehmerzahl, daher reicht das Aktualisieren der Auswahl.
  const handleChanged = useCallback((updated: Activity) => {
    setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  }, []);

  // Beim ersten bekannten Standort einmalig auf den 5-km-Radius um mich zoomen.
  // (Nicht auf die Aktivitäten – der User will seinen eigenen Umkreis sehen.)
  useEffect(() => {
    if (didCenter.current || !userCoords) return;
    didCenter.current = true;
    mapRef.current?.animateToRegion(regionAround(userCoords, RADIUS_KM), 600);
  }, [userCoords]);

  // Kein Standort verfügbar (z. B. Berechtigung abgelehnt): grob auf die Pins
  // einpassen, damit man überhaupt etwas sieht.
  useEffect(() => {
    if (userCoords || didCenter.current || items.length === 0) return;
    const coords = items.map((a) => ({ latitude: a.coords.lat, longitude: a.coords.lng }));
    if (coords.length === 1) {
      mapRef.current?.animateToRegion(regionAround(coords[0], RADIUS_KM), 500);
      return;
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 100, right: 80, bottom: 260, left: 80 },
      animated: true,
    });
  }, [items, userCoords]);

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
        showsUserLocation={showUser}
        showsMyLocationButton={false}
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

      {/* Kopf-Hinweis. Goenni sitzt mit in der Pille und schaut hier nachdenklich
          („wo ist was?") – die Stimmung kommt aus `src/domain/mascot-mood.ts`,
          damit jeder Tab eine andere hat und keine zweimal dieselbe. */}
      <View style={[styles.header, { top: insets.top + Spacing.two }]} pointerEvents="none">
        <View style={[styles.headerPill, styles.headerRow, pillStyle]}>
          {/* Stimmung UND Geste aus der Tabelle: Auf der Karte sieht sie sich
              deutlich um – dort ist Suchen die Tätigkeit und nicht bloß ein
              Lebenszeichen. */}
          <Mascot
            mood={reactionFor('map').mood}
            gesture={reactionFor('map').gesture}
            size={30}
            color={theme.tint}
          />
          <ThemedText type="smallBold">Aktivitäten in der Nähe</ThemedText>
        </View>
      </View>

      {/* Lade-/Fehleranzeige */}
      {loading && items.length === 0 ? (
        <View style={[styles.center, { top: insets.top }]} pointerEvents="none">
          <View style={[styles.headerPill, pillStyle]}>
            <ActivityIndicator color={theme.tint} />
          </View>
        </View>
      ) : null}
      {!loading && error ? (
        <View style={[styles.center, { top: insets.top }]} pointerEvents="none">
          <View style={[styles.headerPill, styles.centerCard, pillStyle]}>
            <MascotError detail={error} size={72} />
          </View>
        </View>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <View style={[styles.center, { top: insets.top }]} pointerEvents="none">
          <View style={[styles.headerPill, styles.centerCard, pillStyle]}>
            <MascotEmpty mood="asleep" size={72} color={theme.tint}>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Noch keine Aktivitäten mit Ort.
              </ThemedText>
            </MascotEmpty>
          </View>
        </View>
      ) : null}

      {/* Auf meinen Standort zentrieren */}
      <Pressable
        onPress={centerOnUser}
        style={({ pressed }) => [
          styles.locateButton,
          {
            backgroundColor: theme.background,
            bottom: insets.bottom + BottomTabInset + Spacing.three,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <ThemedText style={[styles.locateIcon, { color: theme.tint }]}>◎</ThemedText>
      </Pressable>

      {/* Detail-Popup mit allen Infos + Beitreten/Verlassen (wie auf Home),
          zusätzlich mit „Route anzeigen". */}
      <ActivityDetailModal
        activity={selected}
        onClose={() => setSelected(null)}
        onChanged={handleChanged}
        onRoute={handleRoute}
      />
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
  /** Figur und Text nebeneinander in der Kopf-Pille. */
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  /**
   * Dieselbe Fläche, aber als Karte statt als Pille.
   *
   * Nötig, seit in der Mitte eine Figur mit zwei Zeilen Text steht: `borderRadius:
   * 999` macht aus einem hohen Kasten eine Linse, und die sah aus wie ein
   * Darstellungsfehler. Eine Pille ist eine Pille, solange sie eine Zeile hoch ist.
   */
  centerCard: {
    borderRadius: Radius.panel,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    maxWidth: 320,
  },
  centerText: { textAlign: 'center' },
  locateButton: {
    position: 'absolute',
    right: Spacing.three,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  locateIcon: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
  },
});
