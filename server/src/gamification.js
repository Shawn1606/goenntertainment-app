/**
 * Punkte-Logik der Server-Seite (Tickets #17/#18).
 *
 * Die Gewichte stehen NUR hier. Sowohl die JS-Berechnung (fuer /api/me/progress)
 * als auch die SQL-Sortierung des Leaderboards leiten sich daraus ab – damit
 * Anzeige und Rangfolge nicht auseinanderlaufen koennen.
 *
 * Die App zeigt Level, Titel und Abzeichen aus denselben Kennzahlen an; die
 * Regeln dafuer liegen in src/domain/gamification.ts (dort auch getestet).
 * Aendert sich ein Gewicht, muss es an beiden Stellen angepasst werden – die
 * Tests in server/test/gamification.test.js und src/domain/gamification.test.ts
 * halten die Formeln jeweils fest.
 */

export const XP_WEIGHTS = {
  perHosted: 50,
  perJoined: 20,
  perDistinctInterest: 10,
};

/** Kennzahlen eines Kontos, alle auf 0. */
export function emptyStats() {
  return { hosted: 0, joined: 0, distinctInterests: 0 };
}

/** Robuste Zahl: alles Unsinnige wird zu 0, negative Werte werden gekappt. */
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Gesamt-XP aus den Kennzahlen. */
export function xpFromStats(stats = {}) {
  return (
    count(stats.hosted) * XP_WEIGHTS.perHosted +
    count(stats.joined) * XP_WEIGHTS.perJoined +
    count(stats.distinctInterests) * XP_WEIGHTS.perDistinctInterest
  );
}

/**
 * Dieselbe Formel als SQL-Ausdruck – fuer ORDER BY im Leaderboard.
 * @param {{hosted: string, joined: string, distinctInterests: string}} columns Spalten-/Alias-Namen
 */
export function xpSqlExpression(columns) {
  return (
    `(${columns.hosted} * ${XP_WEIGHTS.perHosted}` +
    ` + ${columns.joined} * ${XP_WEIGHTS.perJoined}` +
    ` + ${columns.distinctInterests} * ${XP_WEIGHTS.perDistinctInterest})`
  );
}
