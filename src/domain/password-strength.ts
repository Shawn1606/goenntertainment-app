/**
 * Wie sicher ist ein Passwort? – als Ampel mit konkreten Tipps.
 *
 * ## Was hier gemessen wird (und was nicht)
 *
 * Ein Passwort ist nicht stark, weil es „ein Sonderzeichen hat". `Passwort1!`
 * erfüllt jede Regel mit Zeichenklassen und steht trotzdem in jeder
 * Angreifer-Liste. Entscheidend ist, wie viele Versuche ein Angreifer braucht –
 * und der probiert zuerst: bekannte Passwörter, Wörter mit angehängter Zahl,
 * Tastaturfolgen, Jahreszahlen, den eigenen Namen. Genau diese Muster ziehen hier
 * Punkte ab; Länge bringt die meisten Punkte, weil jede Stelle die Zahl der
 * Möglichkeiten vervielfacht.
 *
 * Das ist bewusst eine Schätzung im Stil von zxcvbn, keine Kryptografie. Die
 * harte Grenze zieht der Server (≥ 8 Zeichen, Buchstaben UND Zahlen, nicht in
 * der Liste häufiger Passwörter, kein Benutzername darin) – `meetsPolicy` sagt
 * vorab, ob er das Passwort annehmen wird, damit man nicht erst beim Absenden
 * davon erfährt.
 *
 * Die Liste häufiger Passwörter kommt als Parameter herein (`shared/common-
 * passwords.json`, dieselbe Datei wie am Server) – so bleibt diese Datei ohne
 * Abhängigkeiten und im Test ohne Metro lauffähig.
 */

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export type PasswordStrength = {
  score: PasswordScore;
  label: string;
  /** Konkrete nächste Schritte, wichtigster zuerst. Leer bei „Sehr stark". */
  hints: string[];
  /** Wird der Server dieses Passwort annehmen? */
  meetsPolicy: boolean;
};

export type PasswordContext = {
  /** Benutzername, E-Mail, Name – alles, was ein Angreifer über die Person weiß. */
  personal?: (string | null | undefined)[];
  /** Häufige Passwörter, kleingeschrieben. */
  common?: readonly string[];
};

export const PASSWORD_LABELS: Record<PasswordScore, string> = {
  0: 'Sehr schwach',
  1: 'Schwach',
  2: 'Okay',
  3: 'Stark',
  4: 'Sehr stark',
};

const MIN_LENGTH = 8;

/** Tastatur- und Zahlenreihen, in denen Folgen gesucht werden (vor- und rückwärts). */
const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  'qwertzuiopü',
  'asdfghjklöä',
  'yxcvbnm',
  'qwertyuiop',
  'zxcvbnm',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '€': 'e',
};

function deLeet(value: string): string {
  return value.replace(/[0134578@$!€]/g, (c) => LEET[c] ?? c);
}

/** Kern eines Passworts ohne angehängte Zahlen und Zeichen: „Hallo123!" → „hallo". */
function stem(value: string): string {
  return value.toLowerCase().replace(/[^a-zäöüß]+$/i, '').replace(/^[^a-zäöüß]+/i, '');
}

/** Längste Folge aus einer Reihe (≥ 3 Zeichen), z. B. „1234" oder „qwertz". */
function longestSequence(lower: string): number {
  let best = 0;
  for (const row of SEQUENCES) {
    for (const line of [row, [...row].reverse().join('')]) {
      for (let i = 0; i < lower.length; i++) {
        let len = 0;
        while (i + len < lower.length) {
          const at = line.indexOf(lower.slice(i, i + len + 1));
          if (at === -1) break;
          len++;
        }
        if (len >= 3 && len > best) best = len;
      }
    }
  }
  return best;
}

/** Längste Wiederholung desselben Zeichens bzw. desselben kurzen Musters („abab"). */
function longestRepeat(value: string): number {
  const same = value.match(/(.)\1{2,}/g) ?? [];
  const pattern = value.match(/(.{2,4})\1+/g) ?? [];
  return Math.max(0, ...same.map((m) => m.length), ...pattern.map((m) => m.length));
}

function personalTokens(personal: PasswordContext['personal']): string[] {
  const tokens = new Set<string>();
  for (const raw of personal ?? []) {
    if (!raw) continue;
    const value = raw.toLowerCase();
    // E-Mail: der Teil vor dem @, und dessen Stücke („max.mustermann" → max, mustermann)
    const local = value.includes('@') ? value.split('@')[0] : value;
    for (const part of [local, ...local.split(/[^a-zäöüß0-9]+/)]) {
      if (part.length >= 4) tokens.add(part);
    }
  }
  return [...tokens];
}

export function passwordStrength(password: string, context: PasswordContext = {}): PasswordStrength {
  const value = password ?? '';
  const lower = value.toLowerCase();
  const hints: string[] = [];

  const hasLower = /[a-zäöüß]/.test(value);
  const hasUpper = /[A-ZÄÖÜ]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSymbol = /[^A-Za-zÄÖÜäöüß0-9]/.test(value);
  const hasLetter = hasLower || hasUpper;
  const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  const common = context.common ?? [];
  const commonSet = new Set(common);
  const isCommon =
    commonSet.has(lower) ||
    commonSet.has(deLeet(lower)) ||
    (stem(value).length >= 3 && (commonSet.has(stem(value)) || commonSet.has(deLeet(stem(value)))));

  const personal = personalTokens(context.personal);
  const containsPersonal = personal.some((token) => lower.includes(token) || deLeet(lower).includes(token));

  // Die SERVER-Regel, exakt nachgebaut (api/app/Support/Passwords.php): nur der
  // genaue Listeneintrag und nur Benutzername bzw. der ganze Teil vor dem @, jeweils
  // ab 4 Zeichen. Die Bewertung oben ist absichtlich strenger (Wortstamm,
  // Leetspeak, Namensteile) – aber `meetsPolicy` darf dem Server nicht
  // widersprechen, sonst sagt die App „wird abgelehnt" und der Server nimmt es an.
  const policyCommon = commonSet.has(lower);
  const policyPersonal = (context.personal ?? []).some((raw) => {
    if (!raw) return false;
    const whole = raw.toLowerCase();
    const token = whole.includes('@') ? whole.split('@')[0] : whole;
    return token.length >= 4 && lower.includes(token);
  });

  const sequence = longestSequence(lower);
  const repeat = longestRepeat(lower);
  const hasYear = /(19[5-9]\d|20[0-4]\d)/.test(value);
  const onlyDigits = /^\d+$/.test(value);

  // --- Punkte ------------------------------------------------------------
  // Länge zählt am meisten: 8 Zeichen → 2, 12 → 3, 16 → 4, darüber gedeckelt.
  let points = Math.min(value.length / 4, 5);
  points += Math.max(0, classes - 1) * 0.6;

  if (sequence >= 3) points -= Math.min(sequence, 6) * 0.4;
  if (repeat >= 3) points -= Math.min(repeat, 6) * 0.35;
  if (hasYear) points -= 0.6;
  if (onlyDigits) points -= 1;
  if (containsPersonal) points -= 2;
  if (isCommon) points -= 4;

  let score: PasswordScore = points < 1.5 ? 0 : points < 2.6 ? 1 : points < 3.6 ? 2 : points < 4.6 ? 3 : 4;

  // Harte Obergrenzen: Was ein Angreifer als Erstes probiert, ist nie „okay".
  if (value.length < MIN_LENGTH) score = Math.min(score, 1) as PasswordScore;
  if (isCommon || containsPersonal) score = Math.min(score, 1) as PasswordScore;
  if (value.length === 0) score = 0;

  // --- Tipps (wichtigster zuerst) ----------------------------------------
  if (value.length === 0) {
    hints.push(`Mindestens ${MIN_LENGTH} Zeichen mit Buchstaben und Zahlen.`);
  } else {
    if (isCommon) hints.push('Dieses Passwort steht auf Listen, die Angreifer zuerst ausprobieren.');
    if (containsPersonal) hints.push('Keinen Namen, Benutzernamen oder Teil deiner E-Mail verwenden.');
    if (value.length < MIN_LENGTH) hints.push(`Mindestens ${MIN_LENGTH} Zeichen – noch ${MIN_LENGTH - value.length}.`);
    if (!hasLetter) hints.push('Buchstaben und Zahlen mischen.');
    if (sequence >= 3) hints.push('Folgen wie „1234" oder „qwertz" vermeiden.');
    if (repeat >= 3) hints.push('Wiederholungen wie „aaa" oder „abab" vermeiden.');
    if (hasYear) hints.push('Jahreszahlen wie ein Geburtsjahr sind leicht zu erraten.');
    if (score < 4 && value.length < 14) hints.push('Länger ist besser: Ein Satz aus mehreren Wörtern ist stark und leicht zu merken.');
    if (score < 3 && classes < 3) hints.push('Groß- und Kleinbuchstaben oder ein Sonderzeichen hinzufügen.');
  }

  const meetsPolicy =
    value.length >= MIN_LENGTH && hasLetter && hasDigit && !policyCommon && !policyPersonal;

  // Was der Server verlangt, steht IMMER vorn – auch bei einer starken Passphrase
  // ohne Zahl. Sonst hieße es „Sehr stark" und das Absenden scheiterte trotzdem.
  if (value.length > 0 && !meetsPolicy && hasLetter && !hasDigit) {
    hints.unshift('Die App verlangt mindestens eine Zahl.');
  }

  return {
    score,
    label: PASSWORD_LABELS[score],
    hints: score === 4 && meetsPolicy ? [] : [...new Set(hints)].slice(0, 3),
    meetsPolicy,
  };
}
