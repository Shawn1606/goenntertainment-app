/**
 * Betreiberdaten – die Angaben, die ins Impressum gehören.
 *
 * ## ACHTUNG: Hier stehen Platzhalter
 *
 * Vor der Veröffentlichung müssen die mit `TODO` markierten Werte durch die
 * echten ersetzt werden. Das Impressum (§ 5 DDG) verlangt eine **ladungsfähige
 * Anschrift** – ein Postfach genügt nicht – sowie einen Weg zur schnellen
 * elektronischen Kontaktaufnahme. Nach der Rechtsprechung reicht die E-Mail-
 * Adresse allein nicht: Es braucht einen zweiten direkten Weg (Telefon,
 * Rückrufformular oder Ähnliches).
 *
 * Falsche oder fehlende Angaben sind der klassische Anlass für eine
 * Abmahnung – und zwar unabhängig davon, wie gut die App sonst ist.
 *
 * ## Warum alles an EINER Stelle steht
 *
 * Diese Werte tauchen im Impressum, in den Nutzungsbedingungen, im
 * Datenschutz-Text und in Support-Mails auf. Stünden sie an fünf Stellen, wäre
 * nach dem ersten Umzug vier davon falsch. `src/domain/legal.ts` baut die Texte
 * aus diesen Konstanten zusammen und schreibt sie nirgends aus.
 *
 * Ob noch Platzhalter drinstehen, sagt {@link hasOperatorGaps} – die
 * Einstellungen zeigen dann einen Hinweis, damit es nicht unbemerkt in einen
 * Store-Build wandert.
 */
// Relativ und mit Endung: `src/domain/legal.ts` baut die Rechtstexte aus diesen
// Werten und läuft im Test mit `node --test`, wo es keinen Bundler für `@/` gibt.
import { SUPPORT_EMAIL } from './links.ts';

/** Der Name, unter dem die App auftritt. */
export const APP_NAME = 'GÖ4Fun';

/**
 * Mindestalter für ein Konto.
 *
 * 16 Jahre: Das ist die Altersgrenze, ab der in Deutschland eine Einwilligung in
 * die Datenverarbeitung ohne die Eltern wirksam ist (Art. 8 DSGVO in der
 * deutschen Ausgestaltung). Wer die Grenze niedriger setzen will, braucht eine
 * Einwilligung der Erziehungsberechtigten und einen Weg, sie zu prüfen – das ist
 * eine Produktentscheidung, keine Zeile Code.
 *
 * Named mirror of `min_age` in shared/legal.json, the age the server requires to be confirmed at
 * sign-up (F-14); src/domain/legal.test.ts fails when the two differ.
 */
export const MIN_AGE = 16;

export const OPERATOR = {
  /** Firma bzw. vollständiger Name der betreibenden Person. */
  name: 'TODO: Vor- und Nachname bzw. Firma',
  /** Rechtsform, falls Gesellschaft (z. B. „GmbH"); leer bei Einzelperson. */
  legalForm: '',
  /** Straße und Hausnummer – ladungsfähig, kein Postfach. */
  street: 'TODO: Straße und Hausnummer',
  /** PLZ und Ort. */
  city: 'TODO: PLZ und Ort',
  country: 'Deutschland',
  /** Zweiter direkter Kontaktweg neben der E-Mail (Pflicht, siehe oben). */
  phone: 'TODO: Telefonnummer',
  email: SUPPORT_EMAIL,
  /** Wer nach § 18 Abs. 2 MStV für die Inhalte verantwortlich ist. */
  responsible: 'TODO: Vor- und Nachname',
  /** Umsatzsteuer-Identifikationsnummer, falls vorhanden. */
  vatId: '',
  /** Registergericht und -nummer, falls eingetragen. */
  register: '',
} as const;

/** Die Anschrift als Zeilen – so, wie sie im Impressum untereinander steht. */
export function operatorAddressLines(): string[] {
  return [
    [OPERATOR.name, OPERATOR.legalForm].filter(Boolean).join(' '),
    OPERATOR.street,
    OPERATOR.city,
    OPERATOR.country,
  ].filter(Boolean);
}

/**
 * Stehen noch Platzhalter in den Betreiberdaten?
 *
 * Gibt die Namen der betroffenen Felder zurück (leer = alles gesetzt). Bewusst
 * eine Liste und nicht ein `boolean`: Wer den Hinweis liest, will wissen, was
 * fehlt, und nicht nur, dass etwas fehlt.
 */
export function hasOperatorGaps(): string[] {
  return Object.entries(OPERATOR)
    .filter(([, value]) => typeof value === 'string' && value.startsWith('TODO'))
    .map(([key]) => key);
}
