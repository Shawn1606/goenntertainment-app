/**
 * Storys ausserhalb ihrer Route: die Spalten, die Umwandlung, und die Frage
 * „hat diese Person gerade etwas laufen?".
 *
 * ## Warum das eine eigene Datei ist
 *
 * Die Story-Leiste war lange der einzige Ort, an dem Storys vorkamen – da stand
 * alles in `routes/stories.js`, und das war richtig. Inzwischen fragen drei
 * weitere Stellen dasselbe:
 *
 * - die Profilseite (`routes/profile.js`): Der Ring um das Profilbild oeffnet die
 *   Storys der Person, also braucht die Antwort sie.
 * - die Personenlisten (Freunde, Suche): Dort traegt jedes Bild denselben Ring,
 *   und der braucht nur die ANZAHL – nicht die Bilder selbst.
 * - der Betrachter aus einer Liste heraus (`GET /users/:id/stories`).
 *
 * Jede dieser Stellen den Router importieren zu lassen hiesse, seine Routen
 * mitzunehmen; die Abfrage abzuschreiben hiesse, vier Wahrheiten darueber zu
 * haben, was „laufende Story" bedeutet (abgelaufen? gesperrtes Konto?). Also:
 * eine Datei, die Storys kennt und keine Route – wie `people.js` fuer
 * Beziehungen.
 *
 * ## Zwei Groessen, ein Filter
 *
 * `storiesOf` liefert die Storys selbst, `storyMetaFor` nur Anzahl und
 * „ungesehen" fuer viele Konten auf einmal. Beide filtern gleich: nicht
 * abgelaufen, Konto nicht gesperrt. Steht der Filter zweimal verschieden da,
 * zeigt eine Liste irgendwann einen Ring, hinter dem nichts mehr ist.
 */
import { pool, toIso } from './db.js';
import { mediaUrl, publicBase } from './media.js';

/** Wie lange eine Story sichtbar bleibt. Gegenstueck: `STORY_HOURS` in src/domain/story.ts. */
export const STORY_HOURS = 24;

/** So viele Storys liefert eine Abfrage hoechstens aus. */
export const STORY_LIMIT = 60;

/**
 * Spalten und Verknuepfungen jeder Story-Abfrage.
 *
 * Erwartet ZWEI Platzhalter-Werte, beide die ID der:des Betrachtenden: einmal
 * fuer `is_mine`, einmal fuer die Verknuepfung mit den gesehenen Storys. Die
 * Reihenfolge ist die im Text – erst `SELECT`, dann `LEFT JOIN`.
 */
export const STORY_QUERY = `
  SELECT s.id, s.user_id, s.caption, s.image_path, s.created_at, s.expires_at,
         TIMESTAMPDIFF(MINUTE, NOW(), s.expires_at) AS expires_in_minutes,
         u.name, u.username, u.avatar, u.account_type,
         (v.user_id IS NOT NULL) AS seen,
         (s.user_id = ?) AS is_mine
    FROM stories s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN story_views v ON v.story_id = s.id AND v.user_id = ?`;

/** Nicht abgelaufen, und das Konto dahinter nicht gesperrt. */
export const STORY_LIVE = `s.expires_at > NOW() AND (u.banned_until IS NULL OR u.banned_until <= NOW())`;

/** Eine Story in der Form, die die App erwartet. */
export function transformStory(req, row) {
  return {
    id: row.id,
    caption: row.caption,
    image_url: row.image_path ? `${publicBase(req)}/storage/${row.image_path}` : null,
    created_at: toIso(row.created_at),
    expires_at: toIso(row.expires_at),
    /**
     * Restzeit in Minuten – gerechnet von der DATENBANK, nicht von der App.
     *
     * Grund: `toIso` haengt an einen DB-Zeitstempel schlicht ein 'Z' und
     * behauptet damit UTC. Das gilt hier nicht durchgaengig – `NOW()` liefert die
     * Ortszeit des Servers. Rechnet die App also `expires_at - jetzt`, ist sie um
     * den Zonen-Versatz daneben (aus 24 Stunden wurden sichtbar 25). Eine Dauer
     * kennt keine Zeitzone: `TIMESTAMPDIFF` gegen dasselbe `NOW()`, mit dem auch
     * gefiltert wird, kann per Konstruktion nicht auseinanderlaufen.
     */
    expires_in_minutes: row.expires_in_minutes === undefined ? null : Number(row.expires_in_minutes),
    seen: Boolean(row.seen),
    is_mine: Boolean(row.is_mine),
    user: {
      id: row.user_id,
      name: row.name,
      username: row.username,
      avatar: mediaUrl(req, row.avatar),
      account_type: row.account_type,
    },
  };
}

/**
 * Die laufenden Storys EINER Person, aelteste zuerst.
 *
 * Aelteste zuerst, weil man einen Tag vorwaerts erzaehlt – dieselbe Reihenfolge,
 * in der der Betrachter sie durchblaettert (siehe `groupStories` in
 * src/domain/story.ts).
 */
export async function storiesOf(req, ownerId, viewerId) {
  const [rows] = await pool.query(
    `${STORY_QUERY}
      WHERE s.user_id = ? AND ${STORY_LIVE}
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT ${STORY_LIMIT}`,
    [viewerId, viewerId, Number(ownerId) || 0],
  );
  return rows.map((row) => transformStory(req, row));
}

/**
 * Anzahl und „ungesehen" fuer viele Konten auf einmal.
 *
 * EINE Abfrage fuer die ganze Liste und nicht eine je Zeile: Eine Freundesliste
 * mit 40 Namen waere sonst 40 Abfragen, nur damit ein Ring die richtige Farbe hat.
 *
 * @returns Map von Konto-ID auf `{ count, unseen }`. Wer nichts laufen hat, fehlt
 *   in der Map – das ist der Unterschied zwischen „keine Story" und „alle gesehen".
 */
export async function storyMetaFor(viewerId, userIds) {
  const ids = [...new Set((userIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();

  const [rows] = await pool.query(
    `SELECT s.user_id, COUNT(*) AS count, SUM(v.user_id IS NULL) AS unseen
       FROM stories s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN story_views v ON v.story_id = s.id AND v.user_id = ?
      WHERE s.user_id IN (${ids.map(() => '?').join(', ')}) AND ${STORY_LIVE}
      GROUP BY s.user_id`,
    [viewerId, ...ids],
  );

  return new Map(
    rows.map((row) => [
      Number(row.user_id),
      { count: Number(row.count), unseen: Number(row.unseen) > 0 },
    ]),
  );
}

/**
 * Einer Personenliste ihr `story`-Feld anhaengen.
 *
 * Die Listen der App (Freunde, Anfragen, Suchtreffer) sind bereits umgewandelt,
 * wenn sie hier ankommen – deshalb arbeitet das auf den fertigen Objekten und
 * nicht auf DB-Zeilen. `null` heisst „nichts laeuft": Die App zeichnet dann gar
 * keinen Ring, und genau das ist die Aussage.
 */
export async function attachStories(people, viewerId) {
  const list = people ?? [];
  if (list.length === 0) return list;

  const meta = await storyMetaFor(viewerId, list.map((person) => person.id));
  return list.map((person) => ({ ...person, story: meta.get(Number(person.id)) ?? null }));
}
