/**
 * Ein Event in den Kalender – reine Logik, kein React, kein Netz.
 *
 * ## Warum es das gibt
 *
 * Zwei Dinge aus der Recherche zeigen in dieselbe Richtung:
 *
 *  - Nutzer von Event-Plattformen nennen „add to calendar" auffällig oft als das,
 *    was fehlt oder nicht funktioniert – Termine per Hand abzuschreiben ist der
 *    Bruch zwischen „interessant" und „ich bin da".
 *  - Und: Bei kostenlosen Veranstaltungen erscheint ein deutlich größerer Teil
 *    der Zusagen nicht. Als wirksamstes Gegenmittel gilt nicht mehr Druck,
 *    sondern eine rechtzeitige Erinnerung.
 *
 * Ein Kalendereintrag ist genau diese Erinnerung – und zwar die einzige, die
 * niemand abschalten muss, weil sie im eigenen Kalender steht und nicht in
 * unserer Benachrichtigungsliste. Deshalb ist das hier kein Bequemlichkeits-
 * Feature, sondern das billigste Mittel gegen leere Treffpunkte, das wir haben.
 *
 * ## Warum eine Adresse und kein Kalender-Zugriff
 *
 * Ein echter Kalendereintrag bräuchte `expo-calendar`: ein Native-Modul, einen
 * neuen Dev-Client und eine Berechtigungsabfrage („Zugriff auf deinen Kalender")
 * – für einen einzelnen Termin. Eine Vorlagen-Adresse öffnet stattdessen den
 * Kalender mit vorbelegten Feldern; bestätigen muss man selbst. Das ist weniger
 * Magie, aber es braucht keine Berechtigung, läuft auf jeder Plattform und macht
 * nichts hinter dem Rücken der Nutzer:in.
 */

/**
 * Wie lange ein Termin angesetzt wird, wenn kein Ende bekannt ist.
 *
 * Die API kennt nur `starts_at`. Zwei Stunden sind für ein Treffen die
 * plausibelste Annahme – kurz genug, dass der Abend danach nicht blockiert
 * aussieht, lang genug, dass es nicht nach „huscht vorbei" wirkt. Wer es genauer
 * braucht, ändert es im Kalender, denn dort landet man ohnehin.
 */
export const CALENDAR_DEFAULT_HOURS = 2;

/** Ohne Titel wäre der Eintrag im Kalender nicht wiederzufinden. */
const FALLBACK_TITLE = 'Goenntertainment-Event';

/** Steht am Ende der Beschreibung, damit man später weiß, woher der Termin kam. */
const SIGNATURE = 'Eingetragen über Goenntertainment.';

const BASE = 'https://calendar.google.com/calendar/render';

/** Was zum Bauen des Termins gebraucht wird – absichtlich weniger als `Activity`. */
export type CalendarEvent = {
  title: string;
  description?: string | null;
  location?: string | null;
  /** ISO-Zeitpunkt oder `null`, wenn kein Termin feststeht. */
  starts_at: string | null;
};

/**
 * `Date` → `20260814T183000Z`.
 *
 * Kalender-Adressen wollen kompaktes UTC ohne Trenner. Bewusst aus den
 * `getUTC*`-Werten zusammengesetzt und nicht per `toISOString().replace(…)`:
 * So steht sichtbar da, dass hier UTC gemeint ist, und nicht nur zufällig
 * herauskommt.
 */
export function calendarStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Vorlagen-Adresse für den Kalender – oder `null`, wenn es nichts einzutragen gibt.
 *
 * `null` ist wichtiger als es aussieht: Ein Event ohne (oder mit kaputter)
 * Startzeit darf keinen Knopf bekommen, der ins Nichts führt. Die Anzeige fragt
 * deshalb nicht selbst nach dem Datum, sondern nur, ob hier ein Link herauskommt.
 */
export function calendarLinkFor(event: CalendarEvent): string | null {
  const raw = (event.starts_at ?? '').trim();
  if (raw === '') return null;

  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + CALENDAR_DEFAULT_HOURS * 3_600_000);

  const title = event.title?.trim() || FALLBACK_TITLE;
  const description = event.description?.trim();
  const location = event.location?.trim();

  // `URLSearchParams` maskiert selbst – und zwar richtig. Wichtig für Titel mit
  // `&`, `#` oder Umlauten: Von Hand zusammengebaut zerreißt so ein Titel die
  // Adresse (bei `#` verschwindet stillschweigend alles danach).
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${calendarStamp(start)}/${calendarStamp(end)}`,
    details: description ? `${description}\n\n${SIGNATURE}` : SIGNATURE,
  });
  // Leere Felder weglassen statt als leeren Parameter mitzuschleppen: Ein
  // `location=` ohne Wert legt im Kalender eine leere Ortszeile an.
  if (location) params.set('location', location);

  return `${BASE}?${params.toString()}`;
}
