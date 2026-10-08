import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

import { notifyUser } from '@/lib/confirm';

/** Ein Bild aus Galerie oder Kamera – fertig zum Hochladen. */
export type Picked = { uri: string; name: string; type: string };

/**
 * Woher soll das Bild kommen?
 *
 * Im Web gibt es die Frage nicht: Dort führt der Weg immer in die Dateiauswahl –
 * eine Kamera-Aufnahme gibt es so nicht, und `Alert.alert` hat im Web keine
 * funktionierenden Knöpfe (siehe lib/confirm.ts). Eine Rückfrage wäre dort also
 * eine Sackgasse, aus der man nicht mehr herauskommt.
 */
function askImageSource(label: string): Promise<'gallery' | 'camera' | null> {
  if (Platform.OS === 'web') {
    return Promise.resolve('gallery');
  }
  return new Promise((resolve) => {
    Alert.alert(
      label,
      'Woher soll das Bild kommen?',
      [
        { text: 'Galerie', onPress: () => resolve('gallery') },
        { text: 'Kamera', onPress: () => resolve('camera') },
        { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(null) },
      ],
      { onDismiss: () => resolve(null) },
    );
  });
}

/**
 * Ein Bild aussuchen – oder `null`, wenn abgebrochen wurde bzw. der Zugriff fehlt.
 *
 * Eine Stelle für alle Bilder der App (Profilbild, Partner-Logo und -Banner,
 * Angebotsbild, Beweisbild): Vorher stand derselbe Dreischritt (fragen, Erlaubnis,
 * öffnen) je Bild neu da. `fallbackName` benennt nur die Datei, wenn das System
 * keinen Namen mitgibt.
 *
 * `crop` schaltet das Zuschneiden dazu (siehe {@link CROP}). Bewusst NICHT für
 * Bilder ohne festen Rahmen (etwa ein Beweis-Screenshot): iOS würde jedes
 * Querformat ins Quadrat zwingen.
 */
export async function pickImage(
  label: string,
  fallbackName: string,
  crop?: { aspect: [number, number]; shape?: 'oval' },
): Promise<Picked | null> {
  const source = await askImageSource(label);
  if (!source) return null;

  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    await notifyUser(
      'Kein Zugriff',
      source === 'camera'
        ? 'Bitte erlaube den Zugriff auf deine Kamera.'
        : 'Bitte erlaube den Zugriff auf deine Galerie.',
    );
    return null;
  }

  const options: ImagePicker.ImagePickerOptions = {
    quality: 0.7,
    ...(crop ? { allowsEditing: true, aspect: crop.aspect, shape: crop.shape } : {}),
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `${fallbackName}.${asset.uri.split('.').pop() ?? 'jpg'}`,
    type: asset.mimeType ?? 'image/jpeg',
  };
}
