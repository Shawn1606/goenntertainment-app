/**
 * Folgen – das einseitige Gegenstueck zur Freundschaft.
 *
 * ## Warum das nicht in `people.js` steht
 *
 * `people.js` beantwortet Fragen ueber eine Beziehung ZU ZWEIT: befreundet,
 * blockiert, gemeinsame Gruppe. Folgen ist keine Beziehung, sondern ein Abo –
 * die Entscheidung trifft eine Seite allein, und die andere erfaehrt es nur als
 * Zahl. Das ist ein eigener Begriff, also eine eigene Datei.
 *
 * ## Wozu es gut ist
 *
 * Zwei Dinge, und beide braucht die App:
 *
 *  - **Zahlen auf dem Profil** ("142 Follower, folgt 87").
 *  - **Der Verteiler fuer Benachrichtigungen.** Wer folgt, bekommt mit, wenn die
 *    Person eine Story, ein Event oder einen Beitrag veroeffentlicht (siehe
 *    `notifications.js`). Ohne Folgen gaebe es keinen Verteiler – Freundschaft
 *    waere der falsche: Man will Veranstaltern folgen koennen, ohne mit ihnen
 *    befreundet zu sein.
 *
 * ## Blockieren schlaegt Folgen
 *
 * Wer blockiert ist, kann nicht folgen, und eine bestehende Folge wird beim
 * Blockieren in BEIDE Richtungen aufgeloest (siehe `dropFollowsBetween`). Sonst
 * bekaeme eine blockierte Person weiter jede Veroeffentlichung mit – das waere
 * genau das, was Blockieren verhindern soll.
 */
import { pool, first } from './db.js';

/** Folgt A der Person B? */
export async function isFollowing(followerId, followingId) {
  const row = await first(
    'SELECT 1 AS ok FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1',
    [followerId, followingId],
  );
  return Boolean(row);
}

/**
 * Follower- und Gefolgt-Zahl eines Kontos.
 *
 * Zwei Unterabfragen in EINEM Aufruf statt zweier Roundtrips: Die Profilseite
 * braucht immer beide Zahlen zusammen, nie nur eine.
 */
export async function followCounts(userId) {
  const row = await first(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS followers,
       (SELECT COUNT(*) FROM follows WHERE follower_id  = ?) AS following`,
    [userId, userId],
  );
  return {
    followers: Number(row?.followers ?? 0),
    following: Number(row?.following ?? 0),
  };
}

/**
 * Folgen. Idempotent – zweimal Folgen ist einmal Folgen.
 *
 * @returns true, wenn dadurch eine NEUE Folge entstanden ist. Nur dann darf eine
 *   Benachrichtigung rausgehen; sonst benachrichtigt jedes erneute Tippen aufs
 *   selbe Profil noch einmal.
 */
export async function follow(followerId, followingId) {
  const [result] = await pool.query(
    `INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [followerId, followingId],
  );
  // mysql2 meldet 1 fuer eine neue Zeile, 0 wenn das ON DUPLICATE nichts geaendert hat.
  return result.affectedRows === 1;
}

/** Nicht mehr folgen. Ohne bestehende Folge ist das kein Fehler. */
export async function unfollow(followerId, followingId) {
  await pool.query('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [
    followerId,
    followingId,
  ]);
}

/** Beide Richtungen loesen – beim Blockieren. */
export async function dropFollowsBetween(a, b) {
  await pool.query(
    `DELETE FROM follows
      WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)`,
    [a, b, b, a],
  );
}

/**
 * Die IDs aller, die dieser Person folgen – der Verteiler.
 *
 * Blockierte fallen hier schon raus, obwohl `dropFollowsBetween` sie beim
 * Blockieren entfernt: Ein Block kann aelter sein als diese Funktion, und ein
 * Verteiler, der sich auf Aufraeumen von frueher verlaesst, ist der falsche Ort
 * fuer Vertrauen.
 */
export async function followerIdsOf(userId) {
  const [rows] = await pool.query(
    `SELECT f.follower_id AS id
       FROM follows f
       JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = f.follower_id AND b.blocked_id = ?)
              OR (b.blocker_id = ? AND b.blocked_id = f.follower_id)
        )
        AND (u.banned_until IS NULL OR u.banned_until <= NOW())`,
    [userId, userId, userId],
  );
  return rows.map((row) => Number(row.id));
}
