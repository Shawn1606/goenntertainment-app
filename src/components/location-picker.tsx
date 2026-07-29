import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LatLng, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useBrandSurface, useTheme } from '@/hooks/use-theme';
import { setPickedLocation } from '@/lib/pending-location';

// Grober Startausschnitt (Deutschland), bis der Standort da ist.
const DEFAULT_REGION: Region = {
  latitude: 51.1657,
  longitude: 10.4515,
  latitudeDelta: 6,
  longitudeDelta: 6,
};

/** Zerlegt eine Adresse in Straße, Ort und eine gut lesbare Gesamtzeile. */
function splitAddress(p: Location.LocationGeocodedAddress): {
  street: string;
  place: string;
  label: string;
} {
  // Fürs Straßenfeld NUR echte Straße + Hausnummer verwenden. `p.name` ist je
  // nach Plattform oft die ganze Adresszeile oder ein POI-Name („Stadtpark") –
  // das gehört nicht ins Straßenfeld, sonst wird es ungenau.
  const street = [p.street, p.streetNumber].filter(Boolean).join(' ');
  const city = [p.postalCode, p.city ?? p.subregion].filter(Boolean).join(' ');
  // Für die reine Anzeige darf der name als Fallback rein (z. B. Park ohne Straße).
  const parts = [street || p.name, city, p.country].filter(Boolean);
  // Doppelte (z. B. name == street) vermeiden.
  const label = [...new Set(parts)].join(', ');
  return { street, place: city, label };
}

/**
 * Vollbild-Karte zum Auswählen eines Ortes. Tippen (oder Pin ziehen) setzt den
 * Marker; die Adresse wird per Reverse-Geocoding ermittelt. „Übernehmen" gibt
 * Adresse + Koordinaten über den Zwischenspeicher zurück ans Formular.
 */
export default function LocationPicker() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useTheme();
  const surface = useBrandSurface();
  const mapRef = useRef<MapView>(null);

  const [marker, setMarker] = useState<LatLng | null>(null);
  const [address, setAddress] = useState<{ street: string; place: string; label: string }>({
    street: '',
    place: '',
    label: '',
  });
  const [resolving, setResolving] = useState(false);
  const reverseSeq = useRef(0);

  // Beim Öffnen: Standort holen und dorthin zoomen (falls erlaubt).
  useEffect(() => {
    let active = true;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!active || status !== 'granted') return;
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        mapRef.current?.animateToRegion(
          { ...here, latitudeDelta: 0.02, longitudeDelta: 0.02 },
          600,
        );
      } catch {
        // Standort gerade nicht verfügbar – Nutzer tippt den Ort selbst an.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const resolveAddress = useCallback(async (coords: LatLng) => {
    const seq = ++reverseSeq.current;
    setResolving(true);
    try {
      const results = await Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      // Nur übernehmen, wenn seither nicht erneut getippt wurde.
      if (seq !== reverseSeq.current) return;
      setAddress(results[0] ? splitAddress(results[0]) : { street: '', place: '', label: '' });
    } catch {
      if (seq === reverseSeq.current) setAddress({ street: '', place: '', label: '' });
    } finally {
      if (seq === reverseSeq.current) setResolving(false);
    }
  }, []);

  const onPickPoint = useCallback(
    (coords: LatLng) => {
      setMarker(coords);
      resolveAddress(coords);
    },
    [resolveAddress],
  );

  function confirm() {
    if (!marker) return;
    const fallback = `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}`;
    setPickedLocation({
      street: address.street.trim(),
      place: address.place.trim(),
      label: address.label.trim() || fallback,
      coords: { lat: marker.latitude, lng: marker.longitude },
    });
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Ort auswählen',
          headerTintColor: colors.tint,
          headerBackTitle: 'Zurück',
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { color: colors.text },
        }}
      />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        onPress={(e) => onPickPoint(e.nativeEvent.coordinate)}>
        {marker ? (
          <Marker
            coordinate={marker}
            pinColor={colors.tint}
            draggable
            onDragEnd={(e) => onPickPoint(e.nativeEvent.coordinate)}
          />
        ) : null}
      </MapView>

      {/* Hinweis oben */}
      <View style={[styles.hint, { top: insets.top + Spacing.two }]} pointerEvents="none">
        <Text style={[styles.hintText, { backgroundColor: colors.backgroundElement, color: colors.text }]}>
          Tippe auf die Karte, um den Ort zu setzen
        </Text>
      </View>

      {/* Ausgewählter Ort + Übernehmen */}
      <View
        style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + Spacing.three }]}>
        <Text style={[styles.sheetLabel, { color: colors.textSecondary }]}>Ausgewählter Ort</Text>
        {marker ? (
          resolving ? (
            <View style={styles.addressRow}>
              <ActivityIndicator color={colors.tint} />
              <Text style={[styles.addressMuted, { color: colors.textSecondary }]}>Adresse wird gesucht…</Text>
            </View>
          ) : (
            <Text style={[styles.address, { color: colors.text }]}>
              {address.label || `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}`}
            </Text>
          )
        ) : (
          <Text style={[styles.addressMuted, { color: colors.textSecondary }]}>Noch kein Ort gewählt.</Text>
        )}

        <Pressable
          onPress={confirm}
          disabled={!marker}
          style={({ pressed }) => [
            styles.confirmButton,
            { backgroundColor: surface.accent },
            { opacity: !marker ? 0.4 : pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.confirmText, { color: surface.accentText }]}>Diesen Ort übernehmen</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    overflow: 'hidden',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  sheetLabel: { fontSize: 13, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  address: { fontSize: 16, minHeight: 22 },
  addressMuted: { fontSize: 15, minHeight: 22 },
  confirmButton: {
    marginTop: Spacing.two,
    borderRadius: 16,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  confirmText: { fontSize: 16, fontWeight: '700' },
});
