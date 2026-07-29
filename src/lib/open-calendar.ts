/**
 * Eine Kalender-Vorlage öffnen.
 *
 * Der Link selbst wird in `src/domain/calendar-link.ts` gebaut (und dort
 * getestet); hier steht nur das Öffnen – also der Teil, der ein Gerät braucht
 * und sich nicht sinnvoll testen lässt.
 *
 * `WebBrowser` und nicht `Linking`: Auf Android greift die Google-Kalender-App
 * die Adresse ab und öffnet den Termin direkt – das ist der beste Fall. Wo keine
 * App das übernimmt, bleibt es beim In-App-Browser, statt die Nutzer:in aus der
 * App zu werfen. Schlägt beides fehl, versucht `Linking` es als letzten Ausweg
 * über den Systembrowser.
 */
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import * as feedback from '@/lib/feedback';

export async function openCalendar(url: string): Promise<void> {
  feedback.tapped();
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    try {
      await Linking.openURL(url);
    } catch {
      // Kein Browser, kein Kalender – dann bleibt der Termin eben ungespeichert.
      // Eine Fehlermeldung hilft hier niemandem weiter, weil es nichts zu tun gibt.
      feedback.failed();
    }
  }
}
