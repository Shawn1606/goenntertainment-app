/**
 * Benachrichtigungen: was in meiner Abwesenheit passiert ist.
 *
 * ## Der Text wird beim ENTSTEHEN geschrieben, nicht beim Lesen
 *
 * Jede Zeile traegt `title` und `body` fertig ausformuliert. Das ist Absicht und
 * die wichtigste Entscheidung hier: Eine Benachrichtigung ist ein Ereignis aus
 * der Vergangenheit. Wuerde der Text erst beim Anzeigen aus dem Gegenstand
 * gebaut, verschwaende jede Story-Meldung nach 24 Stunden – und ein geloeschter
 * Beitrag risse eine Luecke in einen Verlauf, der ihn nur erwaehnt hat.
 *
 * `ref_id` hat aus demselben Grund keinen Fremdschluessel. Sie ist ein
 * Wegweiser, kein Besitzverhaeltnis: Die App springt damit ans Ziel und faengt
 * ab, wenn es das nicht mehr gibt.
 *
 * ## Zustellen darf nie den Ausloeser kippen
 *
 * Eine Story ist veroeffentlicht, sobald sie in der Tabelle steht. Ob 300 Leute
 * davon erfahren haben, ist dafuer unerheblich. Deshalb faengt jede Fan-out-
 * Funktion ihre Fehler selbst – ein Fehler im Verteiler darf nicht dazu fuehren,
 * dass die Story mit 500 abgelehnt wird, obwohl sie schon online ist.
 *
 * ## Ein INSERT fuer alle Empfaenger
 *
 * Bei 500 Followern waeren 500 einzelne INSERTs 500 Roundtrips. Es wird deshalb
 * in Bloecken eingefuegt ({@link CHUNK}) – gross genug, dass es selten mehr als
 * eine Anfrage wird, klein genug fuer das Platzhalter-Limit von MySQL.
 */
import crypto from 'node:crypto';
import { pool, toIso } from './db.js';
import { mediaUrl } from './media.js';
import { followerIdsOf } from './follows.js';
import { logError } from './log.js';
import { notBlockedWith } from './people.js';

/**
 * SQL condition: a notification the recipient may see (alias `n`). Notifications caused by
 * someone in a block relation with the recipient, in either direction, are left out of the list
 * and of every unread counter (F-13, F-08): they carry the other person's name and, for comments,
 * their text. Notifications without an actor (system messages) always count. Takes TWO bound
 * values, both the recipient's id.
 */
export const VISIBLE_NOTIFICATION = `(n.actor_id IS NULL OR ${notBlockedWith('n.actor_id')})`;

/** Sorten, die es gibt. Neue Sorte = Zeile hier und ein Symbol in der App. */
export const NOTIFICATION_TYPES = ['story', 'activity', 'post', 'like', 'comment', 'follow'];

/** So viele Empfaenger pro INSERT. */
const CHUNK = 200;

/** So viele Benachrichtigungen liefert die Liste hoechstens aus. */
export const NOTIFICATION_LIMIT = 60;

/** Laenge der beiden Textspalten – dieselben Zahlen wie in schema.sql. */
const MAX_TITLE = 160;
const MAX_BODY = 300;

/** Schneidet auf die Spaltenbreite und haengt ein Auslassungszeichen an. */
function clamp(value, max) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** One row, through `db` (the pool or one connection of it). */
function insertOne(db, { userId, actorId, type, refId, title, body }) {
  return db.query(
    `INSERT INTO notifications (user_id, actor_id, type, ref_id, title, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [userId, actorId, type, refId, clamp(title, MAX_TITLE) ?? type, clamp(body, MAX_BODY)],
  );
}

/**
 * Eine Benachrichtigung an EINE Person.
 *
 * Die eigene Handlung benachrichtigt nie einen selbst: Wer gerade etwas
 * veroeffentlicht hat, weiss das.
 */
export async function notify({ userId, actorId = null, type, refId = null, title, body = null }) {
  if (!userId || Number(userId) === Number(actorId)) return;
  await insertOne(pool, { userId, actorId, type, refId, title, body });
}

/** How long notifyOnce waits for a concurrent call with the same key, in seconds. */
const ONCE_LOCK_WAIT_SECONDS = 5;

/**
 * Name of the MySQL named lock for one notifyOnce key. Names may have at most 64 characters, so
 * the key is hashed. Names are server-wide: a collision would only make two calls wait for each
 * other, never change what they write.
 */
function onceLockName({ userId, actorId, type, refId }) {
  const key = JSON.stringify([
    Number(userId),
    actorId === null ? null : Number(actorId),
    String(type),
    refId === null ? null : Number(refId),
  ]);
  return `goenn:notify-once:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

/**
 * Like notifyQuietly, for a gesture that can be withdrawn and repeated (a like, a follow): at
 * most ONE row per recipient, actor, type and target (F-07).
 *
 * The rule: no new row while a notification with the same `user_id`, `actor_id`, `type` and
 * `ref_id` exists, whatever its age and whether it has been read. The routes call this only for a
 * NEW like or follow (a fresh row in post_likes or follows), but after an unlike or unfollow the
 * next one is fresh again, so without this rule a like/unlike or follow/unfollow loop notified
 * the other person once per cycle. Withdrawing leaves the earlier row in place: a notification
 * records something that happened (head of this file), and removing it would make the next like
 * count as the first one again.
 *
 * Check and insert run under a MySQL named lock for exactly this key (GET_LOCK), so two requests
 * at the same moment cannot both find "none yet". A single INSERT ... SELECT ... WHERE NOT EXISTS
 * is not enough: its read takes shared next-key locks on the recipient's index range, so two
 * DIFFERENT people notifying the same person at the same moment can deadlock, and one of the two
 * notifications is lost (test/notify-once.test.js). The named lock only serialises calls with the
 * same key. The check reads through the existing indexes on user_id or actor_id; none covers the
 * whole key.
 *
 * Never throws: like every notification, it must not undo the like or follow it reports.
 */
export async function notifyOnce({ userId, actorId = null, type, refId = null, title, body = null }) {
  if (!userId || Number(userId) === Number(actorId)) return;
  const lock = onceLockName({ userId, actorId, type, refId });
  let connection = null;
  try {
    connection = await pool.getConnection();
    const [[{ locked }]] = await connection.query('SELECT GET_LOCK(?, ?) AS locked', [
      lock,
      ONCE_LOCK_WAIT_SECONDS,
    ]);
    if (locked !== 1) throw new Error('notifyOnce: lock not acquired in time');
    try {
      const [[existing]] = await connection.query(
        `SELECT 1 AS found FROM notifications
          WHERE user_id = ? AND actor_id <=> ? AND type = ? AND ref_id <=> ?
          LIMIT 1`,
        [userId, actorId, type, refId],
      );
      if (!existing) await insertOne(connection, { userId, actorId, type, refId, title, body });
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
    }
    connection.release();
  } catch (err) {
    // A connection that failed part-way may still hold the lock; closing it releases the lock.
    connection?.destroy();
    logError('Could not deliver a notification', err);
  }
}

/** Dieselbe Nachricht an viele – in Bloecken, siehe Kopf der Datei. */
async function notifyMany(userIds, { actorId, type, refId, title, body }) {
  const recipients = userIds.filter((id) => Number(id) !== Number(actorId));
  if (recipients.length === 0) return 0;

  const safeTitle = clamp(title, MAX_TITLE) ?? type;
  const safeBody = clamp(body, MAX_BODY);

  for (let i = 0; i < recipients.length; i += CHUNK) {
    const block = recipients.slice(i, i + CHUNK);
    await pool.query(
      `INSERT INTO notifications (user_id, actor_id, type, ref_id, title, body, created_at)
       VALUES ${block.map(() => '(?, ?, ?, ?, ?, ?, NOW())').join(', ')}`,
      block.flatMap((id) => [id, actorId, type, refId, safeTitle, safeBody]),
    );
  }
  return recipients.length;
}

/**
 * „X hat etwas veroeffentlicht" an alle Follower.
 *
 * Der einzige Ausloeser, den es laut Wunschliste geben muss – Story, Event und
 * Beitrag laufen alle hier durch. Schluckt seine Fehler (siehe Kopf).
 */
export async function notifyFollowers(actor, { type, refId, title, body }) {
  try {
    const followers = await followerIdsOf(actor.id);
    return await notifyMany(followers, { actorId: actor.id, type, refId, title, body });
  } catch (err) {
    logError('Benachrichtigungen konnten nicht zugestellt werden', err);
    return 0;
  }
}

/** Wie `notify`, schluckt aber seine Fehler – fuer Nebenwege wie Like/Kommentar. */
export async function notifyQuietly(input) {
  try {
    await notify(input);
  } catch (err) {
    logError('Benachrichtigung konnte nicht zugestellt werden', err);
  }
}

/** Eine Benachrichtigung in die API-Form bringen. */
export function transformNotification(req, row) {
  return {
    id: row.id,
    type: row.type,
    ref_id: row.ref_id === null ? null : Number(row.ref_id),
    title: row.title,
    body: row.body,
    read: row.read_at !== null,
    created_at: toIso(row.created_at),
    actor: row.actor_id
      ? {
          id: row.actor_id,
          name: row.actor_name,
          username: row.actor_username,
          avatar: mediaUrl(req, row.actor_avatar),
          account_type: row.actor_account_type,
        }
      : null,
  };
}
