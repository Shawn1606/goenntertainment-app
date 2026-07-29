/**
 * Aktive Tage – die Datengrundlage der Serie („Streak").
 *
 * Diese Datei zaehlt nur mit. Was daraus eine Serie wird (Laenge, Rekord,
 * „laeuft heute ab") rechnet die App in src/domain/streak.ts, dort ist es auch
 * getestet. Gleiches Muster wie bei den XP: Der Server liefert Zahlen, die App
 * deutet sie – so reagiert die Anzeige sofort und die Regeln liegen an einer
 * Stelle.
 *
 * Wichtig fuer die Fairness: Aktive Tage geben KEINE XP und aendern die
 * Rangliste nicht. Sonst koennte man sich durch bloßes Oeffnen der App nach oben
 * klicken, ohne jemals jemanden getroffen zu haben.
 */
import { pool, first } from './db.js';

/** Wie weit zurueck Tage ausgeliefert werden (deckt jede sinnvolle Anzeige ab). */
export const ACTIVE_DAYS_WINDOW = 120;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Was pro Prozess schon geschrieben wurde: userId -> Tag.
 *
 * `requireAuth` laeuft bei JEDER Anfrage. Ohne diese Notiz waere das ein
 * zusaetzlicher Schreibvorgang pro Anfrage; so ist es einer pro Person und Tag.
 */
const stampedToday = new Map();

/** Obergrenze der Notiz, damit sie in einem lang laufenden Prozess nicht waechst. */
const CACHE_LIMIT = 5000;

/** Nur ein wohlgeformtes `YYYY-MM-DD` durchlassen (kommt vom Client!). */
export function safeDay(value) {
  return typeof value === 'string' && DAY_PATTERN.test(value) ? value : null;
}

/**
 * Haelt fest, dass `userId` an `dayHint` aktiv war.
 *
 * `dayHint` ist das LOKALE Datum des Geraets (Header `X-Local-Date`). Ohne den
 * Header nehmen wir das UTC-Datum des Servers – dann kann ein Tag an der
 * Mitternachtsgrenze um eins verrutschen, was fuer eine Serie verkraftbar ist.
 */
export async function markActiveDay(userId, dayHint = null) {
  const day = safeDay(dayHint) ?? new Date().toISOString().slice(0, 10);

  if (stampedToday.get(userId) === day) return;

  // `day = day` ist ein absichtlicher Leerlauf: Damit wird aus dem INSERT ein
  // "gibt es schon? dann nichts tun", ohne vorher zu lesen.
  await pool.query(
    `INSERT INTO user_active_days (user_id, day) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE day = day`,
    [userId, day],
  );

  if (stampedToday.size >= CACHE_LIMIT) stampedToday.clear();
  stampedToday.set(userId, day);
}

/** Die aktiven Tage der letzten `ACTIVE_DAYS_WINDOW` Tage, neueste zuerst. */
export async function activeDaysFor(userId) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day
       FROM user_active_days
      WHERE user_id = ? AND day >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      ORDER BY day DESC`,
    [userId, ACTIVE_DAYS_WINDOW],
  );
  return rows.map((row) => row.day);
}

/**
 * Einmaliges Nachtragen fuer Konten, die es vor der Serie schon gab.
 *
 * Ohne das startet jede:r bei 0, obwohl die App seit Wochen benutzt wird – das
 * faende zu Recht niemand gut. Wir leiten die Tage aus den Spuren ab, die es
 * ohnehin gibt: erstellte Events, Beitritte, angesehene Events. Laeuft nur,
 * solange die Tabelle leer ist, und ist danach ein billiges LIMIT-1-SELECT.
 */
export async function backfillActiveDays() {
  const existing = await first('SELECT 1 AS ok FROM user_active_days LIMIT 1');
  if (existing) return 0;

  const [result] = await pool.query(`
    INSERT IGNORE INTO user_active_days (user_id, day)
    SELECT user_id, day FROM (
      SELECT user_id, DATE(created_at) AS day FROM activities     WHERE created_at IS NOT NULL
      UNION
      SELECT user_id, DATE(created_at) AS day FROM activity_user  WHERE created_at IS NOT NULL
      UNION
      SELECT user_id, DATE(created_at) AS day FROM activity_views WHERE created_at IS NOT NULL
    ) AS traces
    WHERE day IS NOT NULL
  `);
  return Number(result?.affectedRows ?? 0);
}
