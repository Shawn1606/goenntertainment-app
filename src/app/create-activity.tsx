import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { BrandButton } from '@/components/ui/brand-button';
import { Icon } from '@/components/ui/icon';
import { MapPinIcon } from '@/components/ui/icons';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Spacing, FontFamily, Radius } from '@/constants/theme';
import { Features } from '@/constants/features';
import { POINTS_PER_ACTIVITY } from '@/domain/rewards';
import { useBrandSurface, useTheme } from '@/hooks/use-theme';
import { canCreateActivities } from '@/lib/abilities';
import { api, ApiError, type Interest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import { takePickedLocation } from '@/lib/pending-location';
import { useResolvedScheme } from '@/lib/theme-preference';

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

/** Ende einer Sperre lesbar ausgeben („27.07.2026, 14:05 Uhr"). */
function fmtBanUntil(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${fmtTime(d)}`;
}

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
  const { token, logout, user } = useAuth();
  const colors = useTheme();
  const surface = useBrandSurface();
  const isDark = useResolvedScheme() === 'dark';

  /** Events erstellen gibt es ab dem Creator-Konto (siehe src/domain/account.ts). */
  const canCreate = canCreateActivities(user);

  // Schnellstart aus dem ＋-Tab: Kategorie und (bei einer Schnell-Idee) Titel
  // stehen schon drin – beides bleibt änderbar.
  const params = useLocalSearchParams<{ interest?: string; title?: string }>();
  const presetInterest = Number(params.interest) || null;

  const [title, setTitle] = useState(typeof params.title === 'string' ? params.title : '');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState(''); // Ort/Stadt
  const [street, setStreet] = useState(''); // Straße & Hausnummer
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [maxParticipants, setMaxParticipants] = useState('');
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'time'>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number[]>(presetInterest ? [presetInterest] : []);
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
        positiveButton: { textColor: colors.tint },
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
        // Eigene, selbst eingetippte Interessen werden nicht gespeichert, gehen
        // aber zur KI-Prüfung mit (freier Text muss jugendfrei sein).
        interests: selected,
        customInterests,
        banner,
      });
      // Die Punkte gehören genannt: Der Server bucht sie beim Anlegen
      // (server/src/rewards.js), und wer nicht erfährt, dass es sie gibt, sucht
      // sie auch nicht auf der Prämien-Karte. Ein Satz reicht – der Stand steht
      // gleich danach auf der Startseite.
      await notifyUser(
        'Aktivität ist online',
        Features.rewards
          ? `Deine Aktivität ist online – dafür gibt es ${POINTS_PER_ACTIVITY} Prämien-Punkte.`
          : 'Sie steht jetzt im Feed – Leute können direkt mitmachen.',
        'Zum Feed',
      );
      // Zurück in den Feed, wo die neue Aktivität steht – nicht auf den ＋-Tab, von
      // dem man kam. `dismissTo` räumt dabei den Formular-Bildschirm vom Stapel;
      // ohne Stapel (Direktaufruf) ersetzt es einfach durch die Startseite.
      if (router.canDismiss()) router.dismissTo('/');
      else router.replace('/');
    } catch (error) {
      if (error instanceof ApiError) {
        // Nicht jugendfreier Inhalt + automatische Sperre: Der Token ist ab
        // sofort entwertet. Grund zeigen und lokal abmelden, sonst laufen alle
        // weiteren Anfragen ins Leere.
        const ban = error.status === 403 ? error.body?.ban : undefined;
        if (ban) {
          await notifyUser(
            'Konto gesperrt',
            [
              ban.reason ?? 'Dein Inhalt war nicht jugendfrei.',
              ban.banned_until ? `\nGesperrt bis: ${fmtBanUntil(ban.banned_until)}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            'Verstanden',
          );
          await logout();
          return;
        }
        setErrors(error.errors);
        if (Object.keys(error.errors).length === 0) setGeneralError(error.firstError());
      } else {
        setGeneralError('Unbekannter Fehler.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Ohne Creator-Konto gibt es hier nichts zu holen: Der ＋-Knopf ist dann
  // ausgeblendet, aber ein Link oder ein alter Verlauf kann trotzdem hier
  // landen. Der Server lehnt das Anlegen mit 403 ab – also sagen wir es gleich,
  // statt ein Formular zu zeigen, das sich nicht abschicken lässt.
  //
  // Steht bewusst NACH allen Hooks: Ein früherer Ausstieg würde die
  // Hook-Reihenfolge zwischen zwei Durchläufen ändern.
  if (!canCreate) {
    return (
      <HomeBackground style={styles.screen}>
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Neue Aktivität',
            headerTintColor: colors.tint,
            headerBackTitle: 'Zurück',
            headerStyle: { backgroundColor: colors.background },
            headerTitleStyle: { color: colors.text },
          }}
        />
        <View style={styles.locked}>
          <Icon name="lock" size={44} color={colors.tint} />
          <Text style={[styles.lockedTitle, { color: colors.text }]}>Erstellen gibt es ab Creator</Text>
          <Text style={[styles.lockedText, { color: colors.textSecondary }]}>
            {'Mit einem Creator-Konto legst du eigene Events an. Das Upgrade findest du über das ' +
              'Feld „Upgrade" oben links auf der Startseite.'}
          </Text>
          <BrandButton title="Upgrade ansehen" onPress={() => router.replace('/upgrade')} />
        </View>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Neue Aktivität',
          headerTintColor: colors.tint,
          headerBackTitle: 'Zurück',
          headerStyle: { backgroundColor: colors.background },
          headerTitleStyle: { color: colors.text },
        }}
      />
      {/* Die Tastatur-Freistellung macht `KeyboardForm`. Frühere Anläufe hier
          scheiterten daran, dass RNs `KeyboardAvoidingView` ohne `behavior` gar
          nichts tut (die Tastatur legte sich einfach über das Feld) und mit
          `behavior="padding"` über `LayoutAnimation` die Views neu aufbaut (der
          Fokus ging verloren). Die Annahme „Android schiebt selbst frei" gilt
          unter dem ab SDK 54 erzwungenen edge-to-edge nicht mehr. */}
      <View style={styles.flex}>
        <KeyboardForm
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}>
          {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}

          {/* Banner */}
          <Pressable
            onPress={chooseBanner}
            style={[
              styles.banner,
              banner
                ? { backgroundColor: colors.backgroundElement, borderColor: surface.fieldBorder }
                : // Leerer Platzhalter im Kachel-Blau statt Grau – so liest er sich
                  // als Fläche, die auf einen Tipp wartet.
                  { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
            ]}>
            {banner ? (
              <Image source={{ uri: banner.uri }} style={styles.bannerImage} resizeMode="cover" />
            ) : (
              <View style={styles.bannerEmpty}>
                <Icon name="plus" size={32} color={colors.tint} />
                <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
                  Foto hinzufügen (Galerie oder Kamera)
                </Text>
              </View>
            )}
          </Pressable>
          {banner ? (
            <Pressable onPress={() => setBanner(null)} style={styles.removeBanner}>
              <Text style={[styles.removeBannerText, { color: colors.tint }]}>Foto entfernen</Text>
            </Pressable>
          ) : null}
          {/* The server's answer for the image (not a JPEG, PNG or WebP it can read, or refused by
              the moderation): shown here, or the form would stay silent. */}
          {errors.banner?.[0] ? <Text style={styles.fieldError}>{errors.banner[0]}</Text> : null}

          <TextField label="Name" value={title} onChangeText={setTitle} placeholder="z. B. Feierabend-Fußball" error={errors.title?.[0]} />
          <TextField
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
          <TextField
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
                <MapPinIcon size={22} color={colors.tint} />
              </Pressable>
            }
          />
          <TextField
            label="Straße & Hausnummer"
            value={street}
            onChangeText={setStreet}
            placeholder="z. B. Musterstraße 12"
            error={errors.street?.[0]}
          />

          {/* Datum & Uhrzeit als Picker */}
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Datum</Text>
              <Pressable
                onPress={() => openPicker('date')}
                style={[styles.pickerField, { backgroundColor: surface.fieldBg, borderColor: surface.fieldBorder }]}>
                <Text style={[styles.pickerValue, { color: startsAt ? colors.text : surface.fieldPlaceholder }]}>
                  {startsAt ? fmtDate(startsAt) : 'Datum wählen'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.rowItem}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Uhrzeit</Text>
              <Pressable
                onPress={() => openPicker('time')}
                style={[styles.pickerField, { backgroundColor: surface.fieldBg, borderColor: surface.fieldBorder }]}>
                <Text style={[styles.pickerValue, { color: startsAt ? colors.text : surface.fieldPlaceholder }]}>
                  {startsAt ? fmtTime(startsAt) : 'Uhrzeit wählen'}
                </Text>
              </Pressable>
            </View>
          </View>
          {errors.starts_at?.[0] ? <Text style={styles.fieldError}>{errors.starts_at[0]}</Text> : null}

          {/* Maximale Teilnehmerzahl (optional) */}
          <TextField
            label="Max. Teilnehmer (optional)"
            value={maxParticipants}
            onChangeText={(t) => setMaxParticipants(t.replace(/[^0-9]/g, ''))}
            placeholder="Leer = unbegrenzt"
            keyboardType="number-pad"
            error={errors.max_participants?.[0]}
          />

          {/* Interessen */}
          <View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Interessen (max. 5)</Text>
            {interests.length === 0 ? (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Lade Interessen…</Text>
            ) : (
              <View style={styles.chips}>
                {interests.map((interest) => {
                  const on = selected.includes(interest.id);
                  return (
                    <Pressable
                      key={interest.id}
                      onPress={() => toggleInterest(interest.id)}
                      style={[styles.chip, { borderColor: on ? surface.accent : surface.fieldBorder, backgroundColor: on ? surface.chipBg : surface.fieldBg }]}>
                      <Text style={[styles.chipText, { color: on ? surface.accent : colors.text }]}>{interest.name}</Text>
                    </Pressable>
                  );
                })}
                {/* Eigene Interessen (nur im Frontend, nicht in der DB) */}
                {customInterests.map((name) => (
                  <Pressable
                    key={`custom-${name}`}
                    onPress={() => removeCustomInterest(name)}
                    style={[styles.chip, styles.customChip, { borderColor: surface.accent, backgroundColor: surface.chipBg }]}>
                    <Text style={[styles.chipText, { color: surface.accent }]}>{name}</Text>
                    <Text style={[styles.customChipX, { color: surface.accent }]}>×</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Eigenes Interesse hinzufügen */}
            <View style={styles.customRow}>
              <View style={styles.flex}>
                <TextField
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
                  { backgroundColor: surface.accent },
                  { opacity: !customInput.trim() || totalInterests >= MAX_INTERESTS ? 0.4 : pressed ? 0.85 : 1 },
                ]}>
                <Icon name="plus" size={24} color={surface.accentText} />
              </Pressable>
            </View>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Eigene Interessen sind nur für dich sichtbar.
            </Text>
            {/* The server checks the interests too (the word filter on own interests, too many,
                unknown ones): its message is shown here. */}
            {errors.interests?.[0] ? <Text style={styles.fieldError}>{errors.interests[0]}</Text> : null}
          </View>

          <BrandButton title="Veröffentlichen" onPress={onSubmit} loading={submitting} />
        </KeyboardForm>
      </View>

      {/* iOS: Picker in einem kleinen Blatt unten (Android nutzt den System-Dialog) */}
      {Platform.OS === 'ios' && iosPicker ? (
        <Modal transparent animationType="fade" onRequestClose={() => setIosPicker(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setIosPicker(null)} />
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: colors.background, paddingBottom: insets.bottom + Spacing.three },
            ]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {iosPicker === 'date' ? 'Datum wählen' : 'Uhrzeit wählen'}
              </Text>
              <Pressable onPress={() => setIosPicker(null)} hitSlop={10}>
                <Text style={[styles.modalDone, { color: colors.tint }]}>Fertig</Text>
              </Pressable>
            </View>
            {/* Klartext-Anzeige des aktuell gewählten Zeitpunkts – immer sichtbar,
                unabhängig davon, wie der Picker seine Ziffern darstellt. */}
            <Text style={[styles.modalPreview, { color: colors.tint }]}>
              {fmtDate(startsAt ?? roundedNow())} · {fmtTime(startsAt ?? roundedNow())}
            </Text>
            <DateTimePicker
              value={startsAt ?? roundedNow()}
              mode={iosPicker}
              // Datum als Kalender (kein Dreh-Rad), Uhrzeit weiter als Rad.
              display={iosPicker === 'date' ? 'inline' : 'spinner'}
              locale="de-DE"
              // Folgt dem App-Schema: dunkles Blatt → helle Ziffern, helles Blatt → dunkle.
              themeVariant={isDark ? 'dark' : 'light'}
              textColor={colors.text}
              accentColor={colors.tint}
              minimumDate={iosPicker === 'date' ? new Date() : undefined}
              onChange={(_event, picked) => picked && applyPart(iosPicker, picked)}
            />
          </View>
        </Modal>
      ) : null}

      {submitting ? (
        <View
          style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)' }]}
          pointerEvents="none">
          <ActivityIndicator color={colors.tint} size="large" />
        </View>
      ) : null}
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  generalError: { color: '#ef4444', textAlign: 'center' },
  /** Hinweis-Seite für Konten, die (noch) nicht erstellen dürfen. */
  locked: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.five,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  lockedEmoji: { fontSize: 40, lineHeight: 46 },
  lockedTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    textAlign: 'center',
    fontFamily: FontFamily.bold,
  },
  lockedText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    fontFamily: FontFamily.regular,
  },
  banner: {
    height: 160,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
  },
  bannerImage: { width: '100%', height: '100%' },
  bannerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  bannerText: { fontSize: 13 },
  removeBanner: { alignSelf: 'center' },
  removeBannerText: { fontSize: 13, fontWeight: '600' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: Spacing.three },
  rowItem: { flex: 1, gap: Spacing.one },
  fieldError: { color: '#ef4444', fontSize: 13, marginLeft: Spacing.one },
  label: { marginLeft: Spacing.one, marginBottom: Spacing.two, fontSize: 13, fontWeight: '700' },
  hint: { marginLeft: Spacing.one, marginTop: Spacing.two, fontSize: 13 },
  // Feld-Optik wie TextField, aber als antippbarer Auslöser für den Picker.
  pickerField: {
    borderRadius: Radius.field,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    justifyContent: 'center',
  },
  pickerValue: { fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: Radius.chip, borderWidth: 1.5, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  chipText: { fontSize: 14, fontWeight: '600' },
  customChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderStyle: 'dashed',
  },
  customChipX: { fontSize: 16, fontWeight: '700', lineHeight: 16 },
  customRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, marginTop: Spacing.three },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: Radius.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' },
  modalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 15, fontWeight: '700' },
  modalDone: { fontSize: 16, fontWeight: '700' },
  modalPreview: {
    marginTop: Spacing.two,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FontFamily.bold,
  },
});
