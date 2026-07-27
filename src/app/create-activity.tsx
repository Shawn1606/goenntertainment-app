import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandButton } from '@/components/ui/brand-button';
import { BrandTextField } from '@/components/ui/brand-text-field';
import { MapPinIcon } from '@/components/ui/icons';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { api, ApiError, type Interest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { takePickedLocation } from '@/lib/pending-location';

const MAX_INTERESTS = 5;

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
// prettier-ignore
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;

/** Nächste volle Viertelstunde ab jetzt – sinnvoller Startwert für den Picker. */
function roundedNow(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

type Banner = { uri: string; name: string; type: string };

export default function CreateActivityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState(''); // Ort/Stadt
  const [street, setStreet] = useState(''); // Straße & Hausnummer
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [maxParticipants, setMaxParticipants] = useState('');
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'time'>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [customInterests, setCustomInterests] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const totalInterests = selected.length + customInterests.length;

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

  // Ergebnis der Karten-Ortsauswahl abholen, sobald das Formular wieder Fokus hat.
  // Straße und Ort getrennt übernehmen; falls die Karte nur eine Gesamtzeile
  // liefert, landet diese im Orts-Feld.
  useFocusEffect(
    useCallback(() => {
      const picked = takePickedLocation();
      if (!picked) return;
      if (picked.street) setStreet(picked.street);
      if (picked.place) setPlace(picked.place);
      else if (picked.label) setPlace(picked.label);
    }, []),
  );

  function toggleInterest(id: number) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + customInterests.length >= MAX_INTERESTS) {
        Alert.alert('Maximal 5', 'Du kannst höchstens 5 Interessen auswählen.');
        return prev;
      }
      return [...prev, id];
    });
  }

  function addCustomInterest() {
    const name = customInput.trim();
    if (!name) return;
    if (totalInterests >= MAX_INTERESTS) {
      Alert.alert('Maximal 5', 'Du kannst höchstens 5 Interessen auswählen.');
      return;
    }
    const exists =
      customInterests.some((c) => c.toLowerCase() === name.toLowerCase()) ||
      interests.some((i) => i.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      setCustomInput('');
      return;
    }
    setCustomInterests((prev) => [...prev, name]);
    setCustomInput('');
  }

  function removeCustomInterest(name: string) {
    setCustomInterests((prev) => prev.filter((c) => c !== name));
  }

  // --- Datum/Uhrzeit --------------------------------------------------------
  function applyPart(mode: 'date' | 'time', picked: Date) {
    const base = startsAt ?? roundedNow();
    const next = new Date(base);
    if (mode === 'date') {
      next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    } else {
      next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    }
    setStartsAt(next);
  }

  function openPicker(mode: 'date' | 'time') {
    // Sofort einen sinnvollen Startwert setzen, damit man von Anfang an ein
    // konkretes Datum/eine Uhrzeit sieht (nicht erst nach dem ersten Drehen).
    const start = startsAt ?? roundedNow();
    if (!startsAt) setStartsAt(start);

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: start,
        mode,
        is24Hour: true,
        minimumDate: mode === 'date' ? new Date() : undefined,
        // Heller Dialog + Marken-Akzent, damit Ziffern auch im Dunkelmodus
        // des Handys lesbar sind (sonst weiße Schrift auf hellem Grund).
        positiveButton: { textColor: Brand.purple },
        onChange: (event, picked) => {
          if (event.type === 'set' && picked) applyPart(mode, picked);
        },
      });
    } else {
      setIosPicker(mode);
    }
  }
  // -------------------------------------------------------------------------

  function applyAsset(result: ImagePicker.ImagePickerResult) {
    // (Bild aus Galerie/Kamera übernehmen)
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
    applyAsset(await ImagePicker.launchImageLibraryAsync({ quality: 0.7 }));
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Kein Zugriff', 'Bitte erlaube den Zugriff auf deine Kamera.');
      return;
    }
    applyAsset(await ImagePicker.launchCameraAsync({ quality: 0.7 }));
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
    if (!place.trim()) local.place = ['Bitte gib den Ort ein.'];
    if (!street.trim()) local.street = ['Bitte gib die Straße ein.'];
    if (!startsAt) local.starts_at = ['Bitte wähle Datum und Uhrzeit.'];
    else if (startsAt.getTime() < Date.now()) local.starts_at = ['Der Zeitpunkt liegt in der Vergangenheit.'];

    const maxTrimmed = maxParticipants.trim();
    if (maxTrimmed) {
      const n = Number(maxTrimmed);
      if (!Number.isInteger(n) || n < 1) {
        local.max_participants = ['Bitte gib eine ganze Zahl ab 1 ein.'];
      }
    }
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    // Straße & Ort zu einer Adresszeile zusammenfügen (Backend speichert `location`).
    const location = [street.trim(), place.trim()].filter(Boolean).join(', ');

    setSubmitting(true);
    try {
      await api.createActivity(token as string, {
        title: title.trim(),
        description: description.trim(),
        location,
        starts_at: (startsAt as Date).toISOString(),
        max_participants: maxParticipants.trim() ? Number(maxParticipants.trim()) : null,
        // Nur die vordefinierten Interessen (IDs) gehen an die DB.
        // Eigene, selbst eingetippte Interessen bleiben absichtlich nur im Frontend.
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
          headerBackTitle: 'zurück',
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

          {/* Ort & Straße: beide Pflicht. Per Pin lässt sich die Karte öffnen,
              die beide Felder automatisch ausfüllt. */}
          <BrandTextField
            label="Ort / Stadt"
            value={place}
            onChangeText={setPlace}
            placeholder="z. B. 50667 Köln"
            error={errors.place?.[0] ?? errors.location?.[0]}
            rightAccessory={
              <Pressable
                onPress={() => router.push('/pick-location')}
                hitSlop={10}
                accessibilityLabel="Ort auf der Karte auswählen">
                <MapPinIcon size={22} color={Brand.purple} />
              </Pressable>
            }
          />
          <BrandTextField
            label="Straße & Hausnummer"
            value={street}
            onChangeText={setStreet}
            placeholder="z. B. Musterstraße 12"
            error={errors.street?.[0]}
          />

          {/* Datum & Uhrzeit als Picker */}
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Text style={styles.label}>Datum</Text>
              <Pressable onPress={() => openPicker('date')} style={styles.pickerField}>
                <Text style={startsAt ? styles.pickerValue : styles.pickerPlaceholder}>
                  {startsAt ? fmtDate(startsAt) : 'Datum wählen'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.rowItem}>
              <Text style={styles.label}>Uhrzeit</Text>
              <Pressable onPress={() => openPicker('time')} style={styles.pickerField}>
                <Text style={startsAt ? styles.pickerValue : styles.pickerPlaceholder}>
                  {startsAt ? fmtTime(startsAt) : 'Uhrzeit wählen'}
                </Text>
              </Pressable>
            </View>
          </View>
          {errors.starts_at?.[0] ? <Text style={styles.fieldError}>{errors.starts_at[0]}</Text> : null}

          {/* Maximale Teilnehmerzahl (optional) */}
          <BrandTextField
            label="Max. Teilnehmer (optional)"
            value={maxParticipants}
            onChangeText={(t) => setMaxParticipants(t.replace(/[^0-9]/g, ''))}
            placeholder="Leer = unbegrenzt"
            keyboardType="number-pad"
            error={errors.max_participants?.[0]}
          />

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
                {/* Eigene Interessen (nur im Frontend, nicht in der DB) */}
                {customInterests.map((name) => (
                  <Pressable
                    key={`custom-${name}`}
                    onPress={() => removeCustomInterest(name)}
                    style={[styles.chip, styles.customChip]}>
                    <Text style={[styles.chipText, { color: Brand.purple }]}>{name}</Text>
                    <Text style={styles.customChipX}>×</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Eigenes Interesse hinzufügen */}
            <View style={styles.customRow}>
              <View style={styles.flex}>
                <BrandTextField
                  value={customInput}
                  onChangeText={setCustomInput}
                  placeholder="Eigenes Interesse…"
                  returnKeyType="done"
                  onSubmitEditing={addCustomInterest}
                />
              </View>
              <Pressable
                onPress={addCustomInterest}
                disabled={!customInput.trim() || totalInterests >= MAX_INTERESTS}
                style={({ pressed }) => [
                  styles.addButton,
                  { opacity: !customInput.trim() || totalInterests >= MAX_INTERESTS ? 0.4 : pressed ? 0.85 : 1 },
                ]}>
                <Text style={styles.addButtonText}>＋</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>Eigene Interessen sind nur für dich sichtbar.</Text>
          </View>

          <BrandButton title="Activity erstellen" onPress={onSubmit} loading={submitting} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* iOS: Picker in einem kleinen Blatt unten (Android nutzt den System-Dialog) */}
      {Platform.OS === 'ios' && iosPicker ? (
        <Modal transparent animationType="fade" onRequestClose={() => setIosPicker(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setIosPicker(null)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.three }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{iosPicker === 'date' ? 'Datum wählen' : 'Uhrzeit wählen'}</Text>
              <Pressable onPress={() => setIosPicker(null)} hitSlop={10}>
                <Text style={styles.modalDone}>Fertig</Text>
              </Pressable>
            </View>
            {/* Klartext-Anzeige des aktuell gewählten Zeitpunkts – immer sichtbar,
                unabhängig davon, wie der Picker seine Ziffern darstellt. */}
            <Text style={styles.modalPreview}>
              {fmtDate(startsAt ?? roundedNow())} · {fmtTime(startsAt ?? roundedNow())}
            </Text>
            <DateTimePicker
              value={startsAt ?? roundedNow()}
              mode={iosPicker}
              // Datum als Kalender (kein Dreh-Rad), Uhrzeit weiter als Rad.
              display={iosPicker === 'date' ? 'inline' : 'spinner'}
              locale="de-DE"
              // Fest auf hell + dunkle Textfarbe: sonst sind die Ziffern im
              // Dunkelmodus des Handys weiß und auf dem hellen Blatt unsichtbar.
              themeVariant="light"
              textColor={Brand.text}
              accentColor={Brand.purple}
              minimumDate={iosPicker === 'date' ? new Date() : undefined}
              onChange={(_event, picked) => picked && applyPart(iosPicker, picked)}
            />
          </View>
        </Modal>
      ) : null}

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
  rowItem: { flex: 1, gap: Spacing.one },
  fieldError: { color: '#ef4444', fontSize: 13, marginLeft: Spacing.one },
  label: { marginLeft: Spacing.one, marginBottom: Spacing.two, fontSize: 13, fontWeight: '700', color: Brand.textMuted },
  hint: { marginLeft: Spacing.one, marginTop: Spacing.two, color: Brand.textMuted, fontSize: 13 },
  // Feld-Optik wie BrandTextField, aber als antippbarer Auslöser für den Picker.
  pickerField: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Brand.inputBorder,
    backgroundColor: Brand.inputBg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    justifyContent: 'center',
  },
  pickerValue: { fontSize: 16, color: Brand.text },
  pickerPlaceholder: { fontSize: 16, color: '#9ca3af' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 14, borderWidth: 1.5, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  chipText: { fontSize: 14, fontWeight: '600' },
  customChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderColor: Brand.purple,
    backgroundColor: '#f5f3ff',
    borderStyle: 'dashed',
  },
  customChipX: { fontSize: 16, fontWeight: '700', color: Brand.purple, lineHeight: 16 },
  customRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginTop: Spacing.three },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Brand.purple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#ffffff', fontSize: 26, fontWeight: '700', lineHeight: 28 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.4)' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  modalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 15, fontWeight: '700', color: Brand.text },
  modalDone: { fontSize: 16, fontWeight: '700', color: Brand.purple },
  modalPreview: {
    marginTop: Spacing.two,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: Brand.purple,
  },
});
