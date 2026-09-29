/**
 * Gesperrte Begriffe fuer die Formulare der App.
 *
 * Duenne Schicht ueber `src/domain/blocked-terms.ts`: Hier – und nur hier – wird
 * die gemeinsame Liste importiert. Metro packt die JSON-Datei ins Bundle, die App
 * braucht fuer die Pruefung also kein Netz.
 *
 * Die Pruefung ist eine Vorab-Rueckmeldung, keine Sicherung: Der Server lehnt
 * denselben Wert mit demselben Satz ab (422 mit `message`). Weicht die Liste im
 * Bundle einmal von der des Servers ab (alte App-Fassung), gewinnt der Server –
 * die App zeigt seine Meldung ohnehin woertlich an.
 */
import lists from '../../shared/blocked-terms.json';

import {
  blockedTermMessageFor,
  type BlockedTermLists,
  type BlockedTermMode,
} from '@/domain/blocked-terms';

export type { BlockedTermMode } from '@/domain/blocked-terms';

const BLOCKED_TERMS: BlockedTermLists = lists;

/**
 * Meldung fuer ein Formularfeld, oder null, wenn der Wert in Ordnung ist.
 *
 * - `'username'` fuer den Benutzernamen,
 * - `'name'` fuer den Anzeigenamen (echte Nachnamen wie „Fick" gehen hier durch),
 * - `'text'` fuer alles, was man schreibt: Titel, Beschreibung, Ort, Chat,
 *   Beitraege, Kommentare, Story-Unterschriften, Gruppenbeschreibungen.
 *   Gruppenname: `'name'` – er ist eine Selbstbezeichnung wie ein Anzeigename.
 *
 * Leere Werte ergeben null; ob ein Feld Pflicht ist, prueft das Formular selbst.
 */
export function blockedTermMessage(
  value: string | null | undefined,
  mode: BlockedTermMode,
): string | null {
  return blockedTermMessageFor(value, BLOCKED_TERMS, mode);
}
