import { Linking, Platform } from 'react-native';

import type { Coords } from '@/lib/use-location';

/**
 * Öffnet die Route zum Ziel in der Karten-App des Geräts:
 * iOS → Apple Maps, Android/Web → Google Maps. `label` erscheint als Ziel-Name.
 */
export async function openRoute(coords: Coords, label?: string): Promise<void> {
  const dest = `${coords.lat},${coords.lng}`;
  const name = label ? encodeURIComponent(label) : '';

  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${dest}${name ? `&q=${name}` : ''}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;

  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`);
  }
}
