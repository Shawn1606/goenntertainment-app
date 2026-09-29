/**
 * Die Ungelesen-Plakette – eine Regel für alle Zähler der App.
 *
 * Stand ursprünglich in `chat.ts`, weil es sie zuerst nur für Chats gab. Seit
 * auch die Glocke (Benachrichtigungen) eine Plakette trägt, wäre sie dort eine
 * Chat-Regel, die drei Nicht-Chats mitbenutzen – und die zweite Kopie wäre die,
 * die irgendwann bei 999 abschneidet, während die erste bei 99 bleibt.
 */

/** Ab hier wird abgeschnitten. */
const BADGE_LIMIT = 99;

/**
 * Text der Plakette – oder `null`, wenn keine hingehört.
 *
 * `null` und nicht `'0'`: Die Anzeige soll die Plakette dann gar nicht bauen. Ein
 * Kreis mit einer Null darin ist die verwirrendste Form von „nichts Neues".
 *
 * Ab 100 steht „99+": Eine dreistellige Zahl sprengt den Kreis, und zwischen 143
 * und 200 Ungelesenen macht die genaue Zahl ohnehin keinen Unterschied mehr.
 */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > BADGE_LIMIT ? `${BADGE_LIMIT}+` : String(Math.floor(count));
}
