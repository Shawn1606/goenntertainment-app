/**
 * Gefällt mir, Kommentare, Teilnehmende – was an einer Aktivität „sozial" ist,
 * als reine Regeln ohne React.
 *
 * ## Warum das Herz sofort umspringt
 *
 * Ein Herz, das erst nach einer Sekunde reagiert, fühlt sich kaputt an – man
 * tippt ein zweites Mal und nimmt das Like damit wieder zurück. Deshalb zeigt die
 * App den neuen Zustand sofort ({@link toggledLike}) und übernimmt danach die
 * Antwort des Servers, die die echte Zahl trägt. Schlägt die Anfrage fehl,
 * springt es auf den alten Stand zurück.
 */

export type LikeableActivity = {
  likes_count?: number;
  liked_by_me?: boolean;
};

/** Die Aktivität, wie sie nach dem Tipp aufs Herz aussehen WIRD. */
export function toggledLike<T extends LikeableActivity>(activity: T): T {
  const liked = !activity.liked_by_me;
  const count = Math.max(0, (activity.likes_count ?? 0) + (liked ? 1 : -1));
  return { ...activity, liked_by_me: liked, likes_count: count };
}

/** „1 Gefällt mir" / „12 Gefällt mir" – leer bei null, dann steht nichts da. */
export function likesLabel(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return `${formatCount(count)} Gefällt mir`;
}

/** „Alle 4 Kommentare ansehen" – die Zeile unter einem Beitrag. */
export function commentsLabel(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  if (count === 1) return '1 Kommentar ansehen';
  return `Alle ${formatCount(count)} Kommentare ansehen`;
}

/**
 * Kurze Zahl: 999 → „999", 1200 → „1,2 Tsd.", 25000 → „25 Tsd.".
 * Deutsch gerundet, weil die ganze Oberfläche deutsch ist.
 */
export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  const rounded = thousands < 10 ? Math.round(thousands * 10) / 10 : Math.round(thousands);
  return `${String(rounded).replace('.', ',')} Tsd.`;
}

/**
 * Wer ist dabei – in einem Satz.
 *
 *   []                       → null (der Aufrufer zeigt „Sei die:der Erste")
 *   [Anna]                   → „Anna ist dabei"
 *   [Anna, Ben]              → „Anna und Ben sind dabei"
 *   [Anna, Ben, Cem], 7      → „Anna, Ben und 5 weitere sind dabei"
 *
 * `total` ist die echte Zahl (der Server liefert evtl. nicht alle Namen).
 */
export function participantsSentence(names: readonly string[], total = names.length): string | null {
  const count = Math.max(total, names.length);
  if (count === 0) return null;
  if (count === 1) return `${names[0] ?? '1 Person'} ist dabei`;
  if (names.length === 0) return `${count} Personen sind dabei`;
  if (count === 2 && names.length >= 2) return `${names[0]} und ${names[1]} sind dabei`;
  const shown = names.slice(0, 2);
  const rest = count - shown.length;
  return `${shown.join(', ')} und ${rest} ${rest === 1 ? 'weitere Person' : 'weitere'} sind dabei`;
}
