import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandTextField } from '@/components/ui/brand-text-field';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { geocode } from '@/lib/geocode';
import { setPickedLocation } from '@/lib/pending-location';

/**
 * Web-Variante der Ortsauswahl: Eine echte, tippbare Karte gibt es nur in der
 * Handy-App (react-native-maps läuft nicht im Browser). Hier tippt man die
 * Adresse ein; wir suchen die Koordinaten (Geocoding) und geben beides zurück.
 */
export default function LocationPickerWeb() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function confirm() {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setNotFound(false);
    const coords = await geocode(text);
    setSearching(false);
    if (!coords) {
      setNotFound(true);
      return;
    }
    setPickedLocation({
      street: '',
      place: text,
      label: text,
      coords: { lat: coords.lat, lng: coords.lng },
    });
    router.back();
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Ort auswählen',
          headerTintColor: Brand.purple,
          headerBackTitle: 'zurück',
        }}
      />
      <View style={styles.content}>
        <Text style={styles.note}>
          Die tippbare Karte läuft in der Handy-App. Hier kannst du die Adresse eingeben – wir
          suchen den passenden Ort dazu.
        </Text>
        <BrandTextField
          label="Adresse"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setNotFound(false);
          }}
          placeholder="z. B. Stadtpark, Köln"
          autoFocus
        />
        {notFound ? <Text style={styles.error}>Kein Ort zu dieser Adresse gefunden.</Text> : null}

        <Pressable
          onPress={confirm}
          disabled={searching || !query.trim()}
          style={({ pressed }) => [
            styles.confirmButton,
            { opacity: searching || !query.trim() ? 0.4 : pressed ? 0.85 : 1 },
          ]}>
          {searching ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.confirmText}>Ort übernehmen</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9fe' },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  note: { fontSize: 14, color: Brand.textMuted },
  error: { fontSize: 13, color: '#ef4444', marginLeft: Spacing.one },
  confirmButton: {
    backgroundColor: Brand.purple,
    borderRadius: 16,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  confirmText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
