/**
 * Ob zwei Server-Antworten dieselben Daten tragen.
 *
 * Für Zustände, die bei jedem Neuladen ein frisches Objekt bekämen (Angebote,
 * Gruppen, Buchungen, Club): Sind die Daten gleich, bleibt das alte Objekt
 * stehen. Sonst zeichnet jedes Aktualisieren alle Seiten neu, die daran hängen –
 * auch wenn sich nichts geändert hat.
 *
 * Verglichen wird über JSON: Antworten sind reine Daten (keine Funktionen,
 * keine Zyklen), und ein paar Kilobyte zu vergleichen kostet weit weniger als
 * ein Neuzeichnen.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Für `setState((prev) => keepIfSame(prev, next))`: das alte Objekt, wenn die Daten gleich sind. */
export function keepIfSame<T>(prev: T, next: T): T {
  return sameData(prev, next) ? prev : next;
}
