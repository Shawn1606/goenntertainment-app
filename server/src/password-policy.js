/**
 * Passwortregel – dieselbe wie in Laravel (api/app/Support/PasswordPolicy.php).
 *
 * ## Warum es sie hier ueberhaupt gibt
 *
 * Laravel bedient Registrierung und Zuruecksetzen fuer die App. Node hat seine
 * eigenen Fassungen aber noch (routes/auth.js, routes/password.js): Sie sind
 * direkt auf Port 8001 erreichbar, und das Server-Abbild in deploy/ startet
 * sogar NUR dieses Backend. Eine Regel, die nur in Laravel gilt, waere also
 * genau auf dem Weg abwesend, der in Produktion laeuft.
 *
 * ## Die Regel, in dieser Reihenfolge
 *
 *   1. mindestens 8 Zeichen, Buchstaben UND Zahlen (die alte Grundregel, Text
 *      unveraendert – die App kennt ihn seit Monaten);
 *   2. nicht in shared/common-passwords.json (Vergleich kleingeschrieben, als
 *      GANZES Passwort – „geheim" ist verboten, „geheimtipp42" nicht; die App
 *      nutzt dieselbe Datei fuer ihre Staerkeanzeige und rechnet genauso);
 *   3. enthaelt weder den Benutzernamen noch den Teil der E-Mail vor dem @
 *      (ohne Ruecksicht auf Gross/klein, erst ab 4 Zeichen – bei „max" oder
 *      „al" traefe es sonst halbe Woerterbuecher).
 *
 * Die erste verletzte Regel gewinnt: Die App zeigt genau eine Meldung.
 */
import fs from 'node:fs';

export const MSG_PASSWORD_BASIC = 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.';
export const MSG_PASSWORD_COMMON = 'Dieses Passwort ist zu leicht zu erraten – nimm ein anderes.';
export const MSG_PASSWORD_PERSONAL =
  'Das Passwort darf deinen Benutzernamen oder deine E-Mail-Adresse nicht enthalten.';

/** Ab dieser Laenge zaehlt ein Name/E-Mail-Teil als „im Passwort enthalten". */
const MIN_PERSONAL_LENGTH = 4;

/**
 * Die Liste liegt AUSSERHALB von server/ (shared/ im Repo), weil App und
 * Laravel sie ebenfalls lesen – eine Kopie je Stelle liefe auseinander.
 *
 * Fehlt die Datei, startet der Server trotzdem – mit Warnung und ohne Liste.
 * Im Docker-Abbild ist sie inzwischen dabei: deploy/docker-compose.yml reicht
 * shared/ als zusaetzlichen Baukontext durch, das Dockerfile legt es nach
 * /shared. Ein Server, der ohne Liste gar nicht hochkaeme, waere der
 * groessere Schaden; die Grundregel und
 * die Namens-Pruefung gelten weiter. Ueber COMMON_PASSWORDS_FILE laesst sich
 * die Datei dort an einen anderen Ort legen.
 */
function loadCommonPasswords() {
  const file = process.env.COMMON_PASSWORDS_FILE
    ? process.env.COMMON_PASSWORDS_FILE
    : new URL('../../shared/common-passwords.json', import.meta.url);
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(list.map((entry) => String(entry).toLowerCase()));
  } catch (err) {
    console.warn(`[password-policy] Liste haeufiger Passwoerter nicht lesbar (${err.message}) – pruefe ohne sie.`);
    return new Set();
  }
}

const COMMON = loadCommonPasswords();

/** Der Teil vor dem @ – oder null, wenn die Adresse keinen brauchbaren hat. */
function emailLocalPart(email) {
  if (typeof email !== 'string') return null;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : null;
}

/**
 * Die erste verletzte Regel als Meldung – oder null, wenn das Passwort taugt.
 *
 * `username`/`email` duerfen fehlen (z. B. beim Zuruecksetzen fuer eine
 * unbekannte Adresse); dann entfaellt nur die dritte Pruefung fuer sie.
 */
export function passwordProblem(password, { username = null, email = null } = {}) {
  const s = typeof password === 'string' || typeof password === 'number' ? String(password) : '';

  if (s.length < 8 || !/[a-zA-Z]/.test(s) || !/\d/.test(s)) {
    return MSG_PASSWORD_BASIC;
  }

  const lower = s.toLowerCase();
  if (COMMON.has(lower)) {
    return MSG_PASSWORD_COMMON;
  }

  for (const part of [username, emailLocalPart(email)]) {
    if (typeof part === 'string' && part.length >= MIN_PERSONAL_LENGTH && lower.includes(part.toLowerCase())) {
      return MSG_PASSWORD_PERSONAL;
    }
  }

  return null;
}
