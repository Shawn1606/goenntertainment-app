/**
 * Regeln des Chats.
 *
 * ## Ein Raum-Begriff fuer zwei Anlaesse
 *
 * Es gibt zwei Orte, an denen Leute in dieser App miteinander reden: in einer
 * Gruppe und bei einem Event. Das ist dieselbe Handlung, also gibt es dafuer
 * EINEN Raum-Begriff (`chat_rooms`) und nicht zwei Nachrichten-Tabellen.
 *
 * Der Raum ist eine eigene Zeile und nicht bloss ein Spaltenpaar in
 * `chat_messages`: Damit haengt jede Nachricht per Fremdschluessel an ihrem Raum
 * und der Raum per Fremdschluessel an Gruppe bzw. Event. Wird eine Gruppe
 * geloescht, raeumt die Datenbank Raum und Nachrichten mit weg. Mit einem
 * `room_type`/`room_id`-Paar direkt an der Nachricht waere das nicht moeglich –
 * ein Fremdschluessel kann nicht auf zwei Tabellen zeigen, und dann sammeln sich
 * Nachrichten zu Gruppen an, die es nicht mehr gibt.
 *
 * ## Was hier steht und was nicht
 *
 * Hier steht nur, was ohne Datenbank entscheidbar ist: Was in einer Nachricht
 * stehen darf, wie schnell jemand senden darf, wie gross eine Seite ist. Wer
 * lesen und schreiben darf, haengt an Mitgliedschaften – das entscheidet
 * `src/routes/chat.js` mit einer Abfrage.
 */

/** Die beiden Raum-Arten. */
export const ROOM_KINDS = ['group', 'activity'];

/** Bekannte Raum-Art? Die Art kommt aus der URL, also wird sie geprueft. */
export function isRoomKind(value) {
  return typeof value === 'string' && ROOM_KINDS.includes(value);
}

/**
 * Laenge einer Nachricht. Gleiche Zahl wie die Spalte in schema.sql – waere sie
 * dort kleiner, schnitte MySQL still ab, statt eine Meldung zu schicken.
 */
export const MAX_MESSAGE_LENGTH = 1000;

/** So viele Nachrichten darf ein Konto je Zeitfenster senden. */
export const MESSAGE_BURST = 10;

/** Laenge des Zeitfensters der Bremse. */
export const MESSAGE_WINDOW_MS = 10_000;

/** Nachrichten je Seite ohne Angabe. */
export const PAGE_LIMIT_DEFAULT = 50;

/** Obergrenze, damit `?limit=100000` nicht den ganzen Verlauf auf einmal holt. */
export const PAGE_LIMIT_MAX = 100;

const NEWLINE = 10;
const TAB = 9;
const SPACE = 32;
const DELETE = 127;

/**
 * Entfernt Steuerzeichen aus einem Text.
 *
 * Der Zeilenumbruch bleibt: Er ist das einzige Steuerzeichen, das hier Inhalt
 * ist. Ein Tab wird zum Leerzeichen, weil er im Verlauf je nach Geraet
 * unterschiedlich weit springt und damit die Ausrichtung zerlegt.
 *
 * Bewusst als Schleife ueber die Zeichen und nicht als Regex mit Escapes:
 * Eine solche Zeichenklasse ist in der Quelle beim Lesen
 * nicht mehr nachvollziehbar, und beim Bearbeiten landen leicht echte
 * Steuerzeichen in der Datei.
 */
function stripControlChars(text) {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === NEWLINE) {
      out += char;
    } else if (code === TAB) {
      out += ' ';
    } else if (code >= SPACE && code !== DELETE) {
      out += char;
    }
  }
  return out;
}

/** Positive ganze Zahl aus einer Eingabe – oder null. */
function positiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Prueft und raeumt eine eingehende Nachricht.
 *
 * Erlaubt sind drei Formen, weil es drei Absichten gibt: reiner Text, ein
 * geteiltes Event ohne Kommentar (so kommt es aus dem Teilen-Blatt) und beides
 * zusammen. Eine Nachricht ohne Text UND ohne Event ist keine.
 *
 * @returns `{ error: null, body, sharedActivityId }` oder `{ error: Meldung }`.
 */
export function parseMessageInput(input) {
  const raw = input ?? {};

  const body = stripControlChars(String(raw.body ?? '').replace(/\r\n?/g, '\n'))
    // Mehr als eine Leerzeile in Folge schiebt sonst den Verlauf aus dem Bild.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const hasShare =
    raw.activity_id !== undefined && raw.activity_id !== null && raw.activity_id !== '';
  const sharedActivityId = hasShare ? positiveInt(raw.activity_id) : null;

  if (hasShare && sharedActivityId === null) {
    return { error: 'Das geteilte Event konnte nicht gelesen werden.' };
  }
  if (!body && sharedActivityId === null) {
    return { error: 'Schreib etwas, bevor du sendest.' };
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { error: `Eine Nachricht fasst hoechstens ${MAX_MESSAGE_LENGTH} Zeichen.` };
  }

  return { error: null, body, sharedActivityId };
}

/**
 * Ein Schritt der Sende-Bremse.
 *
 * Bewusst pur: Der Zustand (die Zeitstempel) kommt herein und geht wieder
 * hinaus, gehalten wird er vom Aufrufer. Dadurch ist die Regel testbar, ohne die
 * Uhr anzufassen – und es ist der Aufrufer, der entscheidet, ob der Zustand im
 * Speicher liegt oder spaeter in einem gemeinsamen Speicher fuer mehrere
 * Prozesse.
 *
 * Abgewiesene Versuche werden NICHT vermerkt. Sonst verlaengert wiederholtes
 * Klopfen die Sperre selbst, und wer einmal zu schnell war, kaeme nie mehr rein.
 *
 * @param stamps Zeitstempel der letzten erlaubten Nachrichten (ms).
 * @param now Jetzt (ms).
 */
export function nextBurst(stamps, now) {
  const recent = (stamps ?? []).filter((at) => now - at < MESSAGE_WINDOW_MS);

  if (recent.length >= MESSAGE_BURST) {
    const oldest = Math.min(...recent);
    return { allowed: false, stamps: recent, retryAfterMs: MESSAGE_WINDOW_MS - (now - oldest) };
  }

  return { allowed: true, stamps: [...recent, now], retryAfterMs: 0 };
}

/**
 * Seitengroesse aus einem Query-Parameter, in ihren Grenzen gehalten.
 *
 * Der leere String wird VOR `Number` abgefangen: `Number('')` ist 0 und damit
 * eine endliche Zahl – ohne diese Zeile wuerde `?limit=` als „eine Nachricht"
 * gelesen statt als „keine Angabe".
 */
export function pageLimit(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return PAGE_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, Math.floor(n)));
}
