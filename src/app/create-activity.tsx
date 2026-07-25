import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { api, ApiError, type Interest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const MAX_INTERESTS = 5;
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Fr, 25.07.2026" */
function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${WEEKDAYS[d.getDay()]}, ${dd}.${mm}.${d.getFullYear()}`;
}

/** „14:30" */
function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

/** Sinnvoller Startwert für den Picker: heute, nächste volle Stunde. */
function defaultWhen(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Nimmt Datum-Teil aus `picked`, behält Uhrzeit aus `base`. */
function withDate(base: Date | null, picked: Date): Date {
  const b = base ?? defaultWhen();
  return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), b.getHours(), b.getMinutes());
}

/** Nimmt Uhrzeit-Teil aus `picked`, behält Datum aus `base`. */
function withTime(base: Date | null, picked: Date): Date {
  const b = base ?? defaultWhen();
  return new Date(b.getFullYear(), b.getMonth(), b.getDate(), picked.getHours(), picked.getMinutes());
}

type Banner = { uri: string; name: string; type: string };

export default function CreateActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [when, setWhen] = useState<Date | null>(null);
  const [picker, setPicker] = useState<null | 'date' | 'time'>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .interests()
      .then((res) => alive && setInterests(res.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function toggleInterest(id: number) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_INTERESTS) {
        Alert.alert('Maximal 5', 'Du kannst höchstens 5 Interessen auswählen.');
        return prev;
      }
      return [...prev, id];
    });
  }

  function onPickerChange(event: DateTimePickerEvent, picked?: Date) {
    // Android: Dialog schließt sich selbst; „dismissed" = abgebrochen.
    if (Platform.OS === 'android') {
      setPicker(null);
      if (event.type !== 'set' || !picked) return;
    }
    if (!picked) return;
    setWhen((prev) => (picker === 'date' ? withDate(prev, picked) : withTime(prev, picked)));
  }

  function useAsset(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setBanner({
      uri: asset.uri,
      name: asset.fileName ?? `banner.${asset.uri.split('.').pop() ?? 'jpg'}`,
      type: asset.mimeType ?? 'image/jpeg',
    });
  }

  async function pickFromGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Kein Zugriff', 'Bitte erlaube den Zugriff auf deine Galerie.');
      return;
    }
    useAsset(await ImagePicker.launchImageLibraryAsync({ quality: 0.7 }));
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Kein Zugriff', 'Bitte erlaube den Zugriff auf deine Kamera.');
      return;
    }
    useAsset(await ImagePicker.launchCameraAsync({ quality: 0.7 }));
  }

  function chooseBanner() {
    Alert.alert('Banner-Foto', 'Woher soll das Foto kommen?', [
      { text: 'Galerie', onPress: pickFromGallery },
      { text: 'Kamera', onPress: takePhoto },
      { text: 'Abbrechen', style: 'cancel' },
    ]);
  }

  async function onSubmit() {
    setErrors({});
    setGeneralError(null);

    const local: Record<string, string[]> = {};
    if (!title.trim()) local.title = ['Bitte gib einen Namen ein.'];
    if (!description.trim()) local.description = ['Bitte gib eine Beschreibung ein.'];
    if (!location.trim()) local.location = ['Bitte gib einen Ort ein.'];
    if (!when) local.starts_at = ['Bitte Datum und Uhrzeit auswählen.'];
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setSubmitting(true);
    try {
      await api.createActivity(token as string, {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        starts_at: (when as Date).toISOString(),
        interests: selected,
        banner,
      });
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.errors);
        if (Object.keys(error.errors).length === 0) setGeneralError(error.firstError());
      } else {
        setGeneralError('Unbekannter Fehler.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Activity erstellen',
          headerTintColor: Brand.purple,
          headerBackTitle: 'Zurück',
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}
          keyboardShouldPersistTaps="handled">
          {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

          {/* Banner */}
          <Pressable onPress={chooseBanner} style={styles.banner}>
            {banner ? (
              <Image source={{ uri: banner.uri }} style={styles.bannerImage} resizeMode="cover" />
            ) : (
              <View style={styles.bannerEmpty}>
                <Text style={styles.bannerPlus}>＋</Text>
                <Text style={styles.bannerText}>Foto hinzufügen (Galerie oder Kamera)</Text>
              </View>
            )}
          </Pressable>
          {banner ? (
            <Pressable onPress={() => setBanner(null)} style={styles.removeBanner}>
              <Text style={styles.removeBannerText}>Foto entfernen</Text>
            </Pressable>
          ) : null}

          <BrandTextField label="Name" value={title} onChangeText={setTitle} placeholder="z. B. Feierabend-Fußball" error={errors.title?.[0]} />
          <BrandTextField
            label="Beschreibung"
            value={description}
            onChangeText={setDescription}
            placeholder="Worum geht's?"
            multiline
            style={styles.multiline}
            error={errors.description?.[0]}
          />
          <BrandTextField label="Ort" value={location} onChangeText={setLocation} placeholder="z. B. Stadtpark, Köln" error={errors.location?.[0]} />

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <BrandTextField label="Datum" value={date} onChangeText={setDate} placeholder="TT.MM" keyboardType="numbers-and-punctuation" />
            </View>
            <View style={styles.rowItem}>
              <BrandTextField label="Uhrzeit" value={time} onChangeText={setTime} placeholder="HH:MM" keyboardType="numbers-and-punctuation" />
            </View>
          </View>
          {errors.starts_at?.[0] ? <Text style={styles.fieldError}>{errors.starts_at[0]}</Text> : null}

          {/* Interessen */}
          <View>
            <Text style={styles.label}>Interessen (max. 5)</Text>
            {interests.length === 0 ? (
              <Text style={styles.hint}>Lade Interessen…</Text>
            ) : (
              <View style={styles.chips}>
                {interests.map((interest) => {
                  const on = selected.includes(interest.id);
                  return (
                    <Pressable
                      key={interest.id}
                      onPress={() => toggleInterest(interest.id)}
                      style={[styles.chip, { borderColor: on ? Brand.purple : Brand.inputBorder, backgroundColor: on ? '#f5f3ff' : '#ffffff' }]}>
                      <Text style={[styles.chipText, { color: on ? Brand.purple : Brand.text }]}>{interest.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          <BrandButton title="Activity erstellen" onPress={onSubmit} loading={submitting} />
        </ScrollView>
      </KeyboardAvoidingView>

      {submitting ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={Brand.purple} size="large" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9fe' },
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  generalError: { color: '#ef4444', textAlign: 'center' },
  banner: {
    height: 160,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Brand.inputBorder,
    backgroundColor: '#ffffff',
  },
  bannerImage: { width: '100%', height: '100%' },
  bannerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  bannerPlus: { fontSize: 34, color: Brand.purple, fontWeight: '700' },
  bannerText: { fontSize: 13, color: Brand.textMuted },
  removeBanner: { alignSelf: 'center' },
  removeBannerText: { color: Brand.purple, fontSize: 13, fontWeight: '600' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: Spacing.three },
  rowItem: { flex: 1 },
  fieldError: { color: '#ef4444', fontSize: 13, marginLeft: Spacing.one },
  label: { marginLeft: Spacing.one, marginBottom: Spacing.two, fontSize: 13, fontWeight: '700', color: Brand.textMuted },
  hint: { marginLeft: Spacing.one, color: Brand.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 14, borderWidth: 1.5, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  chipText: { fontSize: 14, fontWeight: '600' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.4)' },
});
