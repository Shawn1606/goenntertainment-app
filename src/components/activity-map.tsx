import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityDetailModal } from '@/components/activity-detail-modal';
import { ActivityListSheet } from '@/components/activity-list-sheet';
import { Mascot, MascotEmpty, MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { formatDayTimeShort } from '@/domain/date-format';
import { reactionFor } from '@/domain/mascot-mood';
import { groupByPlace, type PlaceGroup } from '@/domain/place-group';
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

  /**
   * Ein Pin je ORT, nicht je Termin.
   *
   * Das Nörgelbuff allein bringt 143 Termine – als Marker je Termin lägen 143
   * Pins exakt übereinander, sichtbar wäre einer, und die Karte behauptete, in
   * Göttingen gäbe es einen einzigen Abend. Warum ausführlich in
   * `src/domain/place-group.ts`.
   */
  const places = useMemo(() => groupByPlace(items), [items]);

  /** Der angetippte Ort mit mehreren Terminen – `null` heißt: Liste zu. */
  const [place, setPlace] = useState<PlaceGroup<MapActivity> | null>(null);

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
  //
  // Eingepasst wird auf die ORTE und nicht auf die Termine: 143 Punkte, die
  // hundertfach derselbe sind, verzerren den Ausschnitt nicht – aber sie kosten
  // bei jedem Lauf 143 Rechnungen für eine Antwort mit einer Handvoll Punkten.
  useEffect(() => {
    if (userCoords || didCenter.current || places.length === 0) return;
    const coords = places.map((p) => ({ latitude: p.coords.lat, longitude: p.coords.lng }));
    if (coords.length === 1) {
      mapRef.current?.animateToRegion(regionAround(coords[0], RADIUS_KM), 500);
      return;
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 100, right: 80, bottom: 260, left: 80 },
      animated: true,
    });
  }, [places, userCoords]);

  // Falls die ausgewählte Activity aus der Liste fällt: Karte schließen.
  useEffect(() => {
    if (selected && !items.some((a) => a.id === selected.id)) {
      setSelected(null);
    }
  }, [items, selected]);

  /**
   * Das offene Orts-Blatt am frischen Stand halten.
   *
   * `useMapActivities` lädt bei jedem Fokus neu und setzt zwischendurch
   * Teilergebnisse. Ohne diesen Abgleich zeigt ein offenes Blatt die Objekte des
   * vorherigen Laufs – Teilnehmerzahlen und „du bist dabei" stünden dann falsch
   * darin, während die Karte darunter schon richtig ist.
   *
   * Verglichen wird über den Schlüssel und nicht über die Objektgleichheit: Die
   * Gruppen werden bei jedem Lauf neu gebaut und sind nie dasselbe Objekt.
   */
  useEffect(() => {
    if (!place) return;
    const fresh = places.find((candidate) => candidate.key === place.key);
    if (!fresh) setPlace(null);
    else if (fresh !== place) setPlace(fresh);
  }, [places, place]);

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={showUser}
        showsMyLocationButton={false}
        onPress={() => setSelected(null)}>
        {places.map((group) => {
          const count = group.activities.length;
          const next = group.activities[0];

          return (
            <Marker
              key={group.key}
              coordinate={{ latitude: group.coords.lat, longitude: group.coords.lng }}
              // Bei einem Termin steht sein Titel am Pin, bei mehreren der Ort:
              // „jules" hilft niemandem, wenn dahinter dreizehn weitere Abende
              // liegen.
              title={count === 1 ? next.title : group.location}
              description={count === 1 ? group.location : `${count} Termine`}
              pinColor={theme.tint}
              onPress={(e) => {
                // Verhindert, dass onPress der Karte gleich wieder schließt.
                e.stopPropagation();
                // Ein Termin führt direkt ins Detail – ein Zwischenblatt mit
                // genau einem Eintrag wäre ein Tipp ohne Gegenwert.
                if (count === 1) setSelected(next);
                else setPlace(group);
              }}>
              {count > 1 ? (
                <View style={[styles.cluster, { backgroundColor: theme.tint }]}>
                  <ThemedText style={[styles.clusterText, { color: theme.tintText }]}>
                    {count}
                  </ThemedText>
                </View>
              ) : null}
            </Marker>
          );
        })}
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
      {!loading && !error && places.length === 0 ? (
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

      {/* Ein Ort mit mehreren Terminen: erst die Liste, dann das Detail. Das
          Blatt bleibt beim Öffnen eines Termins offen – wer zurückkommt, steht
          wieder in der Liste statt auf der Karte. */}
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
  /**
   * Der Pin für einen Ort mit mehreren Terminen: ein Kreis mit der Anzahl.
   *
   * Die Zahl ist der ganze Zweck – ohne sie sieht ein zusammengefasster Ort
   * genauso aus wie ein einzelner Termin, und niemand käme auf die Idee zu
   * tippen. Feste Maße statt `padding`, damit alle Zähler-Pins gleich groß sind:
   * „3" und „143" dürfen die Karte nicht unterschiedlich schwer machen.
   */
  cluster: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  clusterText: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
});
