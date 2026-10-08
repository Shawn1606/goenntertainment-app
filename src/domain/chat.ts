/**
 * Regeln der Chat-Anzeige – ohne React, ohne Netz.
 *
 * Was hier steht, sind die Entscheidungen, die man beim Lesen eines Verlaufs
 * trifft: Wo fängt ein neuer Tag an? Muss über dieser Nachricht noch einmal der
 * Name stehen? Was zeigt die Plakette bei 4000 ungelesenen? Alles davon lässt
 * sich ohne Bildschirm beantworten und ist deshalb hier und nicht im Screen –
 * dort wäre es zwischen Layout und Ladezuständen nicht mehr prüfbar.
 *
 * Die Typen der Nachrichten kommen aus `src/lib/api.ts`. Diese Datei nimmt
 * bewusst nur die Felder, die sie braucht (`ChatMessageLike`), statt den vollen
 * Typ zu verlangen: So lässt sich jede Funktion mit drei Zeilen Testdaten
 * aufrufen, statt mit einem vollständigen Nachrichten-Objekt.
 */
// Relativ und mit Endung, wie die übrigen Domain-Dateien: Der Testlauf
// (`node --test`) hat keinen Bundler, der `@/` auflösen könnte.
import { formatDaySeparator } from './date-format.ts';

/**
 * Länge einer Nachricht. Muss zu `ChatController::MAX_LENGTH` der API passen –
 * ein Test hier wacht über die Zahl.
 *
 * Warum die Grenze auf beiden Seiten steht: Die App muss den Sende-Knopf sperren
 * können, ohne zu fragen; der Server darf sich nicht darauf verlassen, dass sie
 * es getan hat.
 */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * Wie lange nach einer Nachricht derselben Person deren Name weggelassen wird.
 *
 * Fünf Minuten: lang genug, dass ein Gedanke in drei Nachrichten als ein Block
 * erscheint, kurz genug, dass eine Antwort nach der Mittagspause wieder mit Namen
 * dasteht.
 */
export const SAME_AUTHOR_WINDOW_MS = 5 * 60 * 1000;

/** Nur die Felder, die die Anzeige-Regeln brauchen. */
export type ChatMessageLike = {
  id: number;
  created_at: string | null;
  user: { id: number };
};

/** Eine Tagesgruppe im Verlauf. */
export type DaySection<T> = {
  /** „Heute", „Gestern", „Fr, 24.07." oder das vollständige Datum. */
  label: string;
  messages: T[];
};

/**
 * Fasst den Verlauf in Tagesgruppen zusammen.
 *
 * Die Reihenfolge bleibt, wie sie hereinkommt (der Server liefert aufsteigend).
 * Hier wird **nicht** sortiert: Eine Anzeige, die die Reihenfolge ihrer Daten
 * selbst herstellt, versteckt, wenn der Abruf sie durcheinanderbringt.
 *
 * Nachrichten ohne Zeitpunkt hängen sich an die laufende Gruppe. Sie
 * wegzulassen wäre schlimmer: Eine gerade gesendete Nachricht darf nicht
 * verschwinden, nur weil ein Feld fehlt.
 */
export function groupByDay<T extends ChatMessageLike>(messages: T[], now: Date): DaySection<T>[] {
  const sections: DaySection<T>[] = [];

  for (const message of messages) {
    const label = formatDaySeparator(message.created_at, now);
    const current = sections[sections.length - 1];

    // Ohne Zeitpunkt (label leer) an die laufende Gruppe anhängen; gibt es noch
    // keine, fängt eine ohne Beschriftung an.
    if (current && (label === '' || current.label === label)) {
      current.messages.push(message);
      continue;
    }
    sections.push({ label, messages: [message] });
  }

  return sections;
}

/**
 * Muss über dieser Nachricht der Name der:des Absender:in stehen?
 *
 * Ja bei der ersten Nachricht, bei einem Wechsel der Person und nach einer Pause
 * von mehr als {@link SAME_AUTHOR_WINDOW_MS}. Sonst nein – drei Nachrichten
 * hintereinander mit demselben Namen darüber lesen sich wie drei Gespräche.
 */
export function showsAuthor(
  message: ChatMessageLike,
  previous: ChatMessageLike | null | undefined,
): boolean {
  if (!previous) return true;
  if (previous.user.id !== message.user.id) return true;

  const before = previous.created_at ? new Date(previous.created_at).getTime() : Number.NaN;
  const current = message.created_at ? new Date(message.created_at).getTime() : Number.NaN;
  // Fehlt eine der beiden Zeiten, lieber den Namen zeigen: Das ist die Variante,
  // bei der niemand rätselt, wer geschrieben hat.
  if (Number.isNaN(before) || Number.isNaN(current)) return true;

  return current - before > SAME_AUTHOR_WINDOW_MS;
}

/**
 * Höchste ID der Liste – der Cursor für den nächsten Abruf (`?after=`).
 *
 * Bewusst das Maximum und nicht `messages[messages.length - 1].id`: Käme die
 * Liste einmal nicht aufsteigend, würde die letzte Zeile einen zu kleinen Cursor
 * liefern und der nächste Abruf dieselben Nachrichten erneut holen – oder, bei
 * einem zu großen Wert, welche überspringen.
 */
export function highestId(messages: { id: number }[]): number {
  return messages.reduce((highest, message) => Math.max(highest, message.id), 0);
}

/**
 * Ist der Entwurf sendbar?
 *
 * `error: null` bei leerem Text ist Absicht: Dann ist der Sende-Knopf einfach
 * aus. Eine rote Meldung „du hast noch nichts geschrieben" erklärt jemandem
 * etwas, das er selbst sieht.
 */
export function validateDraft(draft: string): { ok: boolean; error: string | null } {
  const trimmed = draft.trim();
  if (!trimmed) return { ok: false, error: null };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Das ist zu lang – ${MAX_MESSAGE_LENGTH} Zeichen passen in eine Nachricht.`,
    };
  }
  return { ok: true, error: null };
}
