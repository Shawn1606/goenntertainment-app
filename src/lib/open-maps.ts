import { Linking, Platform } from 'react-native';

import type { Coords } from '@/lib/geocode';

/**
 * Öffnet die Route zum Ziel in der Karten-App des Geräts:
 * iOS → Apple Maps, Android/Web → Google Maps. `label` erscheint als Ziel-Name.
 */
export async function openRoute(coords: Coords, label?: string): Promise<void> {
  const dest = `${coords.lat},${coords.lng}`;
  const name = label ? encodeURIComponent(label) : '';

  let url: string;
  if (Platform.OS === 'ios') {
    // Apple Maps mit Fahrt-Route.
    url = `http://maps.apple.com/?daddr=${dest}${name ? `&q=${name}` : ''}&dirflg=d`;
  } else {
    // Google Maps – funktioniert auf Android nativ und im Browser.
    url = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  }

  try {
    await Linking.openURL(url);
  } catch {
    // Fallback: Google-Maps-Weblink versuchen.
    await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`);
  }
}
