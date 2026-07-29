/**
 * Storys: die Zahlen, die App und Server gemeinsam kennen müssen.
 *
 * Gegenstück auf dem Server: `STORY_HOURS` in server/src/routes/stories.js.
 */

/** Wie lange eine Story sichtbar bleibt. */
export const STORY_HOURS = 24;

/**
 * Wie viel Zeit eine Story noch hat, als kurzer Satz.
 *
 * ## Warum das Minuten und kein Zeitstempel sind
 *
 * Naheliegend wäre `new Date(expires_at) - now`. Das war die erste Fassung und sie
 * war um zwei Stunden falsch: Die Datenbank dieses Projekts liefert ihre
 * `NOW()`-Zeitstempel in Ortszeit, ausgeliefert werden sie aber mit einem
 * angehängten „Z", also als UTC (siehe die Notiz in server/src/db.js). Aus einer
 * 24-Stunden-Story wurden dadurch „noch 25 Stunden".
 *
 * Eine Restzeit ist eine **Dauer**, und Dauern brauchen keine Zeitzone. Der Server
 * rechnet sie deshalb selbst (`TIMESTAMPDIFF` gegen dasselbe `NOW()`, mit dem er
 * auch filtert) und schickt Minuten. Damit kann die Anzeige gar nicht mehr von der
 * Zeitzone abhängen.
 *
 * `null`, wenn nichts mehr übrig oder nichts bekannt ist: Dann soll gar nichts
 * stehen. „noch 0 Min." ist die Sorte Angabe, die eine Anzeige unglaubwürdig macht.
 */
export function remainingLabel(minutesLeft: number | null | undefined): string | null {
  if (minutesLeft === null || minutesLeft === undefined) return null;
  const minutes = Math.floor(Number(minutesLeft));
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `noch ${minutes} Min.`;

  const hours = Math.floor(minutes / 60);
  return `noch ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
}
