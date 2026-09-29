/**
 * Story anlegen: ein Bild, optional eine Zeile Text.
 *
 * ## Warum das Bild Pflicht ist
 *
 * Eine Story ohne Bild wäre eine Textkarte – und die gibt es in dieser App schon
 * als Beitrag auf dem Profil. Zwei Wege für dieselbe Sache verwirren mehr, als
 * eine Einschränkung nervt. Der Server prüft dieselbe Regel (422 ohne Bild).
 *
 * ## Was hier NICHT passiert
 *
 * Keine Filter, kein Zuschneiden, kein Zeichnen. Das Bild geht so raus, wie es aus
 * Galerie oder Kamera kommt (`quality: 0.7`, wie beim Event-Banner). Ein
 * Bildeditor ist ein eigenes Produkt; wer eines braucht, hat es auf dem Telefon.
 */
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { GlassButton, GlassCard } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { STORY_HOURS } from '@/domain/story';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { ApiError, api, type ImageUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';
import { goBack } from '@/lib/go-back';

/** Gleiche Zahl wie die Spalte in server/schema.sql. */
const MAX_CAPTION = 200;

export default function CreateStoryScreen() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const glass = useGlass();
  const { token } = useAuth();

  const [image, setImage] = useState<ImageUpload | null>(null);
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyAsset(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setImage({
      uri: asset.uri,
      name: asset.fileName ?? `story.${asset.uri.split('.').pop() ?? 'jpg'}`,
      type: asset.mimeType ?? 'image/jpeg',
    });
    setError(null);
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

  function chooseImage() {
    Alert.alert('Story-Bild', 'Woher soll das Bild kommen?', [
      { text: 'Galerie', onPress: pickFromGallery },
      { text: 'Kamera', onPress: takePhoto },
      { text: 'Abbrechen', style: 'cancel' },
    ]);
  }

  async function onSubmit() {
    if (!token || saving) return;
    if (!image) {
      setError('Wähle zuerst ein Bild.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.createStory(token, image, caption.trim());
      feedback.joined();
      // `goBack` und nicht `router.back()`: Ohne Verlauf tut `back()` NICHTS, und
      // dann bliebe man nach dem Veröffentlichen auf dem Formular stehen. Siehe
      // `src/lib/go-back.ts` – genau dieselbe Falle traf den Zurück-Pfeil.
      goBack();
    } catch (err) {
      feedback.failed();
      setError(
        err instanceof ApiError
          ? err.firstError()
          : 'Die Story konnte nicht veröffentlicht werden. Bitte erneut versuchen.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <HomeBackground style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: 'Story' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <GlassCard tone="accent" radius={Radius.panel} style={styles.intro}>
          <ThemedText type="smallBold" style={{ color: surface.text }}>
            {`Sichtbar für ${STORY_HOURS} Stunden`}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            Danach verschwindet die Story von selbst – Bild und Text werden dabei gelöscht.
          </ThemedText>
        </GlassCard>

        {/* Die Bildfläche IST der Knopf: Eine leere Fläche mit Kamera-Symbol lädt
            zum Antippen ein, ein separater Knopf darunter wäre ein Umweg. */}
        <Pressable
          onPress={chooseImage}
          accessibilityRole="button"
          accessibilityLabel={image ? 'Bild ersetzen' : 'Bild auswählen'}
          style={({ pressed }) => [
            styles.picker,
            { borderColor: image ? surface.chipBorder : glass.border, backgroundColor: glass.fillSubtle },
            pressed && styles.pressed,
          ]}>
          {image ? (
            <Image source={{ uri: image.uri }} style={styles.preview} contentFit="cover" />
          ) : (
            <View style={styles.pickerEmpty}>
              <Icon name="camera" size={30} color={surface.accent} />
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Bild aus Galerie oder Kamera
              </ThemedText>
            </View>
          )}
        </Pressable>

        {image ? (
          <Pressable onPress={() => setImage(null)} accessibilityRole="button" hitSlop={8}>
            <ThemedText type="smallBold" style={[styles.removeImage, { color: surface.accent }]}>
              Bild entfernen
            </ThemedText>
          </Pressable>
        ) : null}

        <TextField
          label="Unterschrift (optional)"
          value={caption}
          onChangeText={setCaption}
          placeholder="Was ist hier los?"
          maxLength={MAX_CAPTION}
          multiline
          hint={`${caption.length}/${MAX_CAPTION}`}
        />

        {error ? <MascotError detail={error} /> : null}

        <GlassButton
          title={saving ? 'Wird veröffentlicht …' : 'Story veröffentlichen'}
          variant="primary"
          disabled={saving || !image}
          onPress={onSubmit}
        />

        {/* Ein Ausweg IM Formular, nicht nur in der Kopfzeile.
            Der Pfeil oben ist der native Zurück-Knopf des Stapels: Steht die App
            direkt auf dieser Adresse (nach einem Neuladen ist das der Normalfall),
            gibt es keinen Verlauf – dann fehlt der Pfeil oder er tut nichts, und
            man kommt hier nicht mehr weg. Dieser Knopf greift immer, weil `goBack`
            im Zweifel auf die Startseite ersetzt. */}
        <Pressable
          onPress={goBack}
          disabled={saving}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={[styles.cancel, { color: surface.textMuted }]}>
            Abbrechen
          </ThemedText>
        </Pressable>
      </ScrollView>
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  intro: { gap: Spacing.one, padding: Spacing.three },
  /** 4:5 wie ein Hochformat-Foto – das Format, in dem Storys aufgenommen werden. */
  picker: {
    aspectRatio: 4 / 5,
    borderRadius: Radius.panel,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmpty: { alignItems: 'center', gap: Spacing.two },
  preview: { width: '100%', height: '100%' },
  removeImage: { textAlign: 'center' },
  cancel: { textAlign: 'center', paddingVertical: Spacing.two },
  pressed: { opacity: 0.8 },
});
