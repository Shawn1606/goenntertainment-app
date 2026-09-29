/**
 * Beziehungen zwischen Konten: Freundschaft, Blockieren, gemeinsame Gruppen.
 *
 * ## Warum das eine eigene Datei ist
 *
 * Freunde (`routes/friends.js`), Gruppen (`routes/groups.js`), Chats
 * (`routes/chat.js`) und die Personensuche (`routes/profile.js`) stellen alle
 * dieselben vier Fragen: Gibt es dieses Konto? Sind die beiden befreundet? Hat
 * eine:r die:den andere:n blockiert? Welche Spalten darf ich nach draussen geben?
 *
 * Vorher stand die Antwort in `routes/friends.js` und die Gruppen lagen in
 * derselben Datei – jeder weitere Aufrufer haette entweder den Freunde-Router
 * importiert (und damit dessen Routen) oder die Abfrage abgeschrieben. Beides ist
 * schlechter als eine Datei, die nur die Beziehungen kennt und keine Route.
 *
 * ## Eine Zeile pro Beziehung, keine Spiegelzeile
 *
 * `friendships` haelt (requester_id, addressee_id, status) – bei einer
 * angenommenen Freundschaft gibt es KEINE zweite Zeile in der Gegenrichtung. Wer
 * die Freunde einer Person sucht, muss deshalb beide Spalten pruefen. Das ist
 * etwas mehr SQL, dafuer kann eine Freundschaft nie halb bestehen (angenommen in
 * einer Richtung, offen in der anderen) – und genau dieser Zustand ist der
 * Fehler, den man mit zwei Zeilen irgendwann produziert.
 *
 * Beim Blockieren ist es umgekehrt: Dort ist die Richtung der Inhalt. „A
 * blockiert B" ist etwas anderes als „B blockiert A", also gibt es eine Zeile je
 * Richtung.
 */
import { pool, first } from './db.js';
import { HttpError } from './validate.js';
import { mediaUrl } from './media.js';

/** Nutzerspalten, die nach draussen gehen. Nie mehr als das. */
export const USER_COLUMNS = 'u.id, u.name, u.username, u.avatar, u.account_type';

/** Ein Konto in der Form, die die App fuer Listen und Chips erwartet. */
export function transformUser(req, row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    avatar: mediaUrl(req, row.avatar),
    account_type: row.account_type,
  };
}

/** Die Beziehung zwischen zwei Konten, in welcher Richtung sie auch angelegt wurde. */
export function existingBetween(a, b) {
  return first(
    `SELECT id, requester_id, addressee_id, status FROM friendships
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [a, b, b, a],
  );
}

/** Sind die beiden bestaetigte Freunde? */
export async function areFriends(a, b) {
  const row = await existingBetween(a, b);
  return Boolean(row && row.status === 'accepted');
}

/**
 * Hat eine:r der beiden die:den andere:n blockiert?
 *
 * Prueft bewusst BEIDE Richtungen: Fuer „darf eine Anfrage entstehen?" ist es
 * gleich, wer blockiert hat. Wer blockiert, will nicht angefragt werden – und wer
 * blockiert wurde, soll nicht anfragen koennen.
 */
export async function blockExistsBetween(a, b) {
  const row = await first(
    `SELECT 1 AS ok FROM user_blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 1`,
    [a, b, b, a],
  );
  return Boolean(row);
}

/** Die IDs, die ich blockiert habe – zum Ausfiltern in Listen. */
export async function blockedIdsOf(userId) {
  const [rows] = await pool.query('SELECT blocked_id FROM user_blocks WHERE blocker_id = ?', [userId]);
  return rows.map((row) => row.blocked_id);
}

/** Das Konto zu einer ID – oder ein 404, das nichts verraet. */
export async function loadUser(id) {
  const row = await first(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, [Number(id) || 0]);
  if (!row) throw new HttpError(404, 'Dieses Konto gibt es nicht.');
  return row;
}

/**
 * Loest die Freundschaft und raeumt dabei die gegenseitigen
 * Gruppen-Mitgliedschaften weg.
 *
 * Ohne diesen zweiten Schritt bliebe jemand in einer Gruppe, in die man ihn nicht
 * mehr aufnehmen koennte – und wuerde dort weiterlesen. Seit es Gruppen-Chats
 * gibt, ist das nicht mehr nur unlogisch, sondern der Grund, warum „Freundschaft
 * beenden" ueberhaupt etwas bewirken muss.
 */
export async function dropSharedGroupMemberships(a, b) {
  await pool.query(
    `DELETE gm FROM group_members gm
       JOIN friend_groups g ON g.id = gm.group_id
      WHERE (g.owner_id = ? AND gm.user_id = ?) OR (g.owner_id = ? AND gm.user_id = ?)`,
    [a, b, b, a],
  );
}
