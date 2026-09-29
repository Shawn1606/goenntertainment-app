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
import { pool, toIso } from './db.js';
import { mediaUrl } from './media.js';
import { followerIdsOf } from './follows.js';

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

/**
 * Eine Benachrichtigung an EINE Person.
 *
 * Die eigene Handlung benachrichtigt nie einen selbst: Wer gerade etwas
 * veroeffentlicht hat, weiss das.
 */
export async function notify({ userId, actorId = null, type, refId = null, title, body = null }) {
  if (!userId || Number(userId) === Number(actorId)) return;
  await pool.query(
    `INSERT INTO notifications (user_id, actor_id, type, ref_id, title, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [userId, actorId, type, refId, clamp(title, MAX_TITLE) ?? type, clamp(body, MAX_BODY)],
  );
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
    console.error('Benachrichtigungen konnten nicht zugestellt werden:', err);
    return 0;
  }
}

/** Wie `notify`, schluckt aber seine Fehler – fuer Nebenwege wie Like/Kommentar. */
export async function notifyQuietly(input) {
  try {
    await notify(input);
  } catch (err) {
    console.error('Benachrichtigung konnte nicht zugestellt werden:', err);
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
