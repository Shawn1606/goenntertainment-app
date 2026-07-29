/**
 * Rückmeldung an einer Stelle: Vibration, Klang – und was zu welchem Moment passt.
 *
 * ## Wozu diese Schicht
 *
 * Vorher stand in den Screens `haptics.success()`. Mit Klängen dazu würde daraus
 * an jeder Stelle `haptics.success(); sound.success();` – und damit läge die
 * Entscheidung „welche Kanäle bedient dieses Ereignis" in fünfzig Dateien. Die
 * erste, die man beim nächsten Klang vergisst, ist die, die niemandem auffällt.
 *
 * Hier benennen Aufrufer stattdessen ein **Ereignis**: `feedback.joined()`. Was
 * dabei passiert, entscheidet die Tabelle unten – ein Ort, an dem man auch sehen
 * kann, ob die Signale noch auseinanderzuhalten sind.
 *
 * Das ist die Abhängigkeitsrichtung, die man will: Der Screen weiß, was der
 * Nutzer getan hat; er weiß nicht (und soll nicht wissen), ob das vibriert,
 * klingt oder beides.
 *
 * ## Die Regeln, nach denen die Tabelle gebaut ist
 *
 *  - **Vibration darf oft, Klang selten.** Jeder Tipp vibriert leicht; einen Ton
 *    gibt es nur für Ergebnisse. Ein Klang pro Tipp wäre nach zwei Minuten
 *    abgeschaltet – und nähme die nützlichen mit.
 *  - **Abschluss-Signale nur am Abschluss.** `success`/`warning`/`error` stehen
 *    am Ende einer Handlung, nie dazwischen. Sonst verlieren sie ihre Bedeutung.
 *  - **Verlassen fühlt sich nicht wie Erfolg an.** Wer austritt, bekommt einen
 *    schlichten Tipp, keine Erfolgsmeldung – und keinen Ton.
 */
import * as haptics from '@/lib/haptics';
import * as sound from '@/lib/sound';

/**
 * Ereignis → Kanäle.
 *
 * Als Tabelle und nicht als Funktionsrumpf pro Ereignis, weil man genau das hier
 * beurteilen muss: In einer Spalte sieht man sofort, ob zu viel klingt.
 */
const CHANNELS = {
  /** Auswahl geändert: Kategorie, Filter, Umschalter. Leichtester Stoß. */
  selected: { haptic: haptics.select, sound: null },
  /** Etwas angetippt, das jetzt losgeht (Karte, Knopf). */
  tapped: { haptic: haptics.tap, sound: null },
  /** Der eine Hauptknopf eines Bildschirms. */
  pressed: { haptic: haptics.press, sound: null },
  /**
   * Ein Blatt geht auf. Nur Klang, keine Vibration: Die Karte, die man dafür
   * angetippt hat, hat schon gestoßen – zweimal wäre ein Ruckeln.
   */
  opened: { haptic: null, sound: sound.pop },
  /** Beigetreten, Event erstellt – der Moment, auf den die App hinausläuft. */
  joined: { haptic: haptics.success, sound: sound.success },
  /** Ausgetreten. Bewusst schlicht. */
  left: { haptic: haptics.tap, sound: null },
  /** Wochenziel, Abzeichen, Level – etwas Erreichtes. */
  achieved: { haptic: haptics.success, sound: sound.goal },
  /** Ging nicht: keine Verbindung, Fehler beim Speichern. */
  failed: { haptic: haptics.error, sound: sound.error },
  /** Nicht möglich: Event ist voll, Recht fehlt. Warnung, kein Fehler. */
  blocked: { haptic: haptics.warning, sound: sound.error },
} as const;

export type FeedbackEvent = keyof typeof CHANNELS;

/**
 * Ein Ereignis melden.
 *
 * Wirft nie und ist nie `await`-pflichtig: Die einzelnen Kanäle schlucken ihre
 * Fehler bereits selbst, und Rückmeldung ist Beiwerk – der eigentliche Ablauf
 * läuft unverändert weiter, wenn Gerät oder Modul nicht mitspielen.
 */
export function emit(event: FeedbackEvent): void {
  const channels = CHANNELS[event];
  channels.haptic?.();
  channels.sound?.();
}

/* Kurzschreibweisen. Aufrufstellen lesen sich damit wie das, was passiert ist. */

/**
 * Den Klang einmal vorspielen, auch wenn er noch aus ist.
 *
 * Nur für den Einstellungs-Bildschirm: Wer den Schalter umlegt, soll hören, was
 * er eingeschaltet hat. Läuft über diese Schicht, damit auch dieser Sonderfall
 * nicht dazu führt, dass ein Screen `sound.ts` direkt kennt.
 */
export function previewSound(): void {
  sound.preview();
  haptics.success();
}

export const selected = () => emit('selected');
export const tapped = () => emit('tapped');
export const pressed = () => emit('pressed');
export const opened = () => emit('opened');
export const joined = () => emit('joined');
export const left = () => emit('left');
export const achieved = () => emit('achieved');
export const failed = () => emit('failed');
export const blocked = () => emit('blocked');
