/**
 * Meldungen von Inhalten und Konten.
 *
 * ## Warum es diesen Weg gibt
 *
 * Die Nutzungsbedingungen sagen, dass die Plattform fuer das, was auf einem
 * Event passiert, nicht haftet und dass die Inhalte von den Nutzer:innen kommen.
 * Das ist nur die eine Haelfte. Die andere ist ein Weg, etwas zu melden – ohne
 * ihn hat die Plattform zwar erklaert, nicht zu haften, aber nichts vorgesehen,
 * um von Problemen ueberhaupt zu erfahren.
 *
 * ## Nur Schluessel, keine Texte
 *
 * Hier stehen die Schluessel der Gruende, nicht ihre Beschriftungen. Die Texte
 * gehoeren in die App (`src/domain/report-reason.ts`), weil sie dort uebersetzt,
 * gekuerzt und umformuliert werden – der Server muss nur wissen, welche Werte er
 * annimmt. Eine zweite Liste von Beschriftungen hier waere eine, die mit der
 * ersten auseinanderlaeuft.
 */

/**
 * Was gemeldet werden kann.
 *
 * `message` ist eine Chat-Nachricht: Seit es Gruppen- und Event-Chats gibt, ist
 * das der Ort, an dem am ehesten etwas gemeldet werden muss.
 */
export const REPORT_TARGETS = ['activity', 'message', 'user', 'post', 'story'];

/**
 * Die Gruende. `other` ist Absicht: Ohne einen Sammelgrund muesste man den
 * passenden erraten – und liesse die Meldung dann.
 */
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'sexual',
  'violence',
  'hate',
  'scam',
  'danger',
  'other',
];

/** Laenge der freien Schilderung; gleiche Zahl wie die Spalte in schema.sql. */
export const MAX_REPORT_NOTE = 500;

/**
 * Prueft eine eingehende Meldung.
 *
 * @returns `{ error: null, targetType, targetId, reason, note }` oder `{ error }`.
 */
export function parseReportInput(input) {
  const raw = input ?? {};

  const targetType = String(raw.target_type ?? '');
  if (!REPORT_TARGETS.includes(targetType)) {
    return { error: 'Das laesst sich nicht melden.' };
  }

  const targetId = Number(raw.target_id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return { error: 'Der gemeldete Inhalt konnte nicht gelesen werden.' };
  }

  const reason = String(raw.reason ?? '');
  if (!REPORT_REASONS.includes(reason)) {
    return { error: 'Waehle einen Grund fuer die Meldung.' };
  }

  const note = String(raw.note ?? '').trim();
  if (note.length > MAX_REPORT_NOTE) {
    // Abschneiden waere schlimmer: Dann faellt genau der Hinweis weg, auf den es
    // ankommt, und niemand erfaehrt davon.
    return { error: `Die Schilderung fasst hoechstens ${MAX_REPORT_NOTE} Zeichen.` };
  }

  return { error: null, targetType, targetId, reason, note: note || null };
}
