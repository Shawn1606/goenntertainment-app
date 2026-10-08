import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { useAppSettings } from '@/lib/app-settings';

export type Coords = { lat: number; lng: number };

/**
 * Der eigene Standort – einmal beim ersten Aufruf, danach aus dem Speicher.
 *
 * Partner tragen ihre Koordinaten selbst (Admin-Bereich), deshalb braucht es
 * kein Geocoding mehr: Die Entfernung ist eine Rechnung, keine Suche.
 *
 * Wer in den Einstellungen „Standort nutzen" ausschaltet, bekommt keinen
 * System-Dialog und `null`.
 */
let cached: Coords | null = null;

export function useLocation(): { coords: Coords | null; denied: boolean } {
  const { settings } = useAppSettings();
  const [coords, setCoords] = useState<Coords | null>(cached);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!settings.useLocation || cached) return;
    let active = true;
    Location.requestForegroundPermissionsAsync()
      .then(async ({ status }) => {
        if (status !== 'granted') {
          if (active) setDenied(true);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        cached = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (active) setCoords(cached);
      })
      .catch(() => {
        if (active) setDenied(true);
      });
    return () => {
      active = false;
    };
  }, [settings.useLocation]);

  // Ausgeschaltet heißt: kein Standort – auch wenn noch einer im Speicher liegt.
  return { coords: settings.useLocation ? (coords ?? cached) : null, denied };
}

/**
 * Standort genau JETZT – für den Check-in am Aufkleber, wo der Server prüft,
 * ob man beim Partner steht. `null`, wenn nicht erlaubt oder nicht zu haben.
 */
export async function currentCoords(): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    cached = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    return cached;
  } catch {
    return null;
  }
}
