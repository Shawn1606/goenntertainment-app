/**
 * Haptik – die kurze Rückmeldung im Handgelenk.
 *
 * Warum das überhaupt? Weil ein Tipp, der sich anfühlt, angekommen ist. Ohne
 * Rückmeldung tippt man im Zweifel noch einmal – und genau daraus entstehen
 * Doppel-Beitritte und das Gefühl, die App reagiere nicht. Ein Stoß von 10 ms
 * ersetzt einen Ladekringel, den es sonst bräuchte.
 *
 * Regeln, an die sich alle Aufrufer halten:
 *  - `select` für Auswahl (Kategorie, Filter, Tab). Der leichteste Stoß.
 *  - `tap` für „ich habe etwas gestartet" (Karte geöffnet, Knopf gedrückt).
 *  - `success` / `warning` / `error` NUR als Abschluss einer Handlung, nie
 *    zwischendrin. Sonst verliert das Signal seine Bedeutung.
 *
 * Alles hier ist absichtlich nie `await`-pflichtig und schluckt jeden Fehler:
 * Vibration ist Beiwerk. Auf Geräten ohne Motor, im Browser oder wenn die
 * Nutzer:in sie abgeschaltet hat, passiert einfach nichts – und der eigentliche
 * Ablauf läuft unverändert weiter.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Ob überhaupt vibriert werden darf. Wird von {@link setHapticsEnabled} aus dem
 * Einstellungs-Provider gesetzt.
 *
 * Bewusst ein Modul-Wert und kein Hook: Diese Funktionen werden aus
 * Ereignis-Handlern und aus reiner Logik gerufen, teils weit weg von React.
 * Ein Hook würde jeden Aufrufer zur Komponente zwingen.
 */
let enabled = true;

/**
 * Web zappelt beim Vibrieren über die Vibration-API, die die meisten Desktop-
 * Browser ohnehin ignorieren – und in manchen eine Konsolen-Warnung pro Aufruf
 * hinterlässt. Auf Web also gar nicht erst versuchen.
 */
const SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

/** Vibration global an-/abschalten (folgt dem Schalter in den Einstellungen). */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

/** Läuft `run`, wenn Haptik erlaubt und möglich ist – und schweigt sonst. */
function fire(run: () => Promise<unknown>): void {
  if (!enabled || !SUPPORTED) return;
  try {
    void run().catch(() => {});
  } catch {
    // Manche Geräte werfen synchron. Auch das ist kein Grund für einen Absturz.
  }
}

/** Auswahl geändert: Kategorie, Filter, Umschalter. Der leichteste Stoß. */
export function select(): void {
  fire(() => Haptics.selectionAsync());
}

/** Etwas angetippt, das jetzt losgeht (Karte, Knopf). */
export function tap(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Kräftigerer Stoß – für den einen Hauptknopf pro Bildschirm. */
export function press(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Handlung geglückt (beigetreten, Event erstellt). */
export function success(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Handlung ging nicht (voll, keine Verbindung). */
export function warning(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Etwas ist schiefgegangen. */
export function error(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
