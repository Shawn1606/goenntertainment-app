/**
 * Chats – in Gruppen und bei Events.
 *
 * ## Der Raum entsteht erst beim ersten Wort
 *
 * Eine Gruppe hat einen Chat, ohne dass dafuer eine Zeile in `chat_rooms` stehen
 * muss. Angelegt wird der Raum erst, wenn jemand tatsaechlich etwas schickt
 * (`ensureRoom`). Der Grund: Sonst braeuchte jede der beiden Stellen, an denen
 * Gruppen und Events entstehen, ein „und leg auch einen Chat-Raum an" – und die,
 * die es vergisst, produziert eine Gruppe ohne Chat. So gibt es diesen Zustand
 * nicht: Kein Raum bedeutet „hier wurde noch nichts geschrieben", und die
 * Uebersicht zeigt die Gruppe trotzdem an.
 *
 * ## Wer lesen darf, darf schreiben
 *
 * Gruppen-Raum: die Mitglieder. Event-Raum: der Host und die Teilnehmer:innen.
 * Es gibt keinen Nur-Lese-Zugang, weil es keinen Grund dafuer gibt – wer bei
 * einem Event mitliest, ist dabei.
 *
 * Wer nicht hineingehoert, bekommt 404 und nicht 403: dieselbe Regel wie bei den
 * Gruppen (siehe routes/groups.js). Ein 403 verraet, dass es den Raum gibt.
 *
 * ## Abholen statt Zustellen
 *
 * Es gibt keine WebSockets. Die App fragt in kurzen Abstaenden nach neuen
 * Nachrichten und schickt dabei die hoechste ID mit, die sie schon hat
 * (`?after=`). Der Server antwortet dann mit dem, was danach kam – meist mit
 * einer leeren Liste, was ein sehr kleiner Aufruf ist. Das ist deutlich weniger
 * elegant als eine offene Verbindung, aber es ist ehrlich zu dem, was dieses
 * Backend ist: ein Express-Prozess ohne Zustand zwischen Anfragen.
 */
import { createRouter } from '../router.js';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError } from '../validate.js';
import { BLOCKED_TERMS, blockedTermMessageFor, findBlockedTerm, findBlockedTermInValue } from '../blocked-terms.js';
import { mediaUrl, publicBase } from '../media.js';
import { isRoomKind, nextBurst, pageLimit, parseMessageInput } from '../messaging.js';
import { notBlockedWith } from '../people.js';

const router = createRouter();

/**
 * Zeitstempel der letzten Nachrichten je Konto – der Zustand der Sende-Bremse.
 *
 * Bewusst im Speicher: Die Bremse soll ein Versehen und ein Skript abfangen, das
 * in einer Schleife sendet. Sie ist keine Sicherheitsgrenze, und ein Neustart des
 * Servers darf sie vergessen. Wuerde sie in der Datenbank stehen, kostete jede
 * Nachricht zwei zusaetzliche Abfragen fuer einen Schutz, der genau nichts
 * garantiert.
 */
const burstByUser = new Map();

/** Prueft die Bremse und merkt sich den neuen Stand. Wirft bei zu schnellem Senden. */
function checkBurst(userId) {
  const step = nextBurst(burstByUser.get(userId), Date.now());
  if (!step.allowed) {
    throw new HttpError(429, 'Kurz durchatmen – das waren viele Nachrichten auf einmal.');
  }
  // Leere Listen wieder loswerden, damit die Karte nicht mit jedem Konto waechst,
  // das einmal etwas geschrieben hat.
  if (step.stamps.length === 0) burstByUser.delete(userId);
  else burstByUser.set(userId, step.stamps);
}

/**
 * Spalten der:des Absender:in – ALLE mit eigenem Namen.
 *
 * Hier steht bewusst nicht das `USER_COLUMNS` aus `src/people.js`: Das beginnt
 * mit `u.id`, und in einer Abfrage, die auch `m.id` holt, kommen dann zwei
 * Spalten namens `id` zurueck. mysql2 baut daraus EIN Objekt, in dem die zweite
 * die erste ueberschreibt – die Nachricht truege dann die ID ihres Absenders.
 * Genau das hat der Integrationstest gefunden (Loeschen und Melden liefen ins
 * 404, weil die mitgegebene ID keine Nachricht war).
 *
 * `u.id` fehlt hier ganz, weil `m.user_id` dieselbe Zahl schon mitbringt.
 */
const AUTHOR_COLUMNS = [
  'u.name AS author_name',
  'u.username AS author_username',
  'u.avatar AS author_avatar',
  'u.account_type AS author_account_type',
].join(', ');

/**
 * Der Raum, seine Bezeichnung und die eigenen Rechte darin – oder ein 404.
 *
 * Gibt `roomId: null` zurueck, wenn noch nie etwas geschrieben wurde. Das ist
 * kein Fehler, sondern der Normalfall bei einer frischen Gruppe.
 *
 * `canModerate` hat, wer den Ort verantwortet: die:der Anlegende einer Gruppe,
 * der Host eines Events – und jeder Admin. Diese Leute duerfen jede Nachricht in
 * ihrem Raum entfernen, nicht nur die eigene.
 */
async function loadRoomForMember(kind, refId, user) {
  const id = Number(refId) || 0;

  if (kind === 'group') {
    const group = await first(
      `SELECT g.id, g.name, g.owner_id
         FROM friend_groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
        WHERE g.id = ?`,
      [user.id, id],
    );
    if (!group) throw new HttpError(404, 'Diesen Chat gibt es nicht.');
    const room = await first('SELECT id FROM chat_rooms WHERE group_id = ?', [group.id]);
    return {
      kind,
      refId: group.id,
      roomId: room?.id ?? null,
      title: group.name,
      canModerate: group.owner_id === user.id || Boolean(user.is_admin),
    };
  }

  // Event-Raum: Host oder Teilnehmer:in. Der Host steht ohnehin in
  // `activity_user` (er tritt beim Anlegen automatisch bei); die Pruefung auf
  // `a.user_id` steht trotzdem da, damit ein Event aus der Zeit davor nicht
  // seinen eigenen Host aussperrt.
  const activity = await first(
    `SELECT a.id, a.title, a.user_id AS owner_id
       FROM activities a
      WHERE a.id = ?
        AND (a.user_id = ?
             OR EXISTS (SELECT 1 FROM activity_user au
                         WHERE au.activity_id = a.id AND au.user_id = ?))`,
    [id, user.id, user.id],
  );
  if (!activity) throw new HttpError(404, 'Diesen Chat gibt es nicht.');
  const room = await first('SELECT id FROM chat_rooms WHERE activity_id = ?', [activity.id]);
  return {
    kind,
    refId: activity.id,
    roomId: room?.id ?? null,
    title: activity.title,
    canModerate: activity.owner_id === user.id || Boolean(user.is_admin),
  };
}

/**
 * Legt den Raum an, falls es ihn noch nicht gibt, und gibt seine ID zurueck.
 *
 * `INSERT IGNORE` statt „nachsehen, dann anlegen": Zwei Leute, die im selben
 * Moment die erste Nachricht schicken, wuerden sonst beide nichts finden und
 * beide anlegen. Der eindeutige Schluessel auf `group_id`/`activity_id` weist den
 * zweiten Versuch ab, und danach steht der Raum fuer beide bereit.
 */
async function ensureRoom(kind, refId) {
  const column = kind === 'group' ? 'group_id' : 'activity_id';
  await pool.query(
    `INSERT IGNORE INTO chat_rooms (kind, ${column}, created_at) VALUES (?, ?, NOW())`,
    [kind, refId],
  );
  const room = await first(`SELECT id FROM chat_rooms WHERE ${column} = ?`, [refId]);
  if (!room) throw new HttpError(500, 'Der Chat konnte nicht angelegt werden.');
  return room.id;
}

/** Eine Nachricht in der Form, die die App erwartet. */
function transformMessage(req, row, userId) {
  return {
    id: row.id,
    body: row.body ?? '',
    created_at: toIso(row.created_at),
    is_mine: row.user_id === userId,
    user: {
      id: row.user_id,
      name: row.author_name,
      username: row.author_username,
      avatar: mediaUrl(req, row.author_avatar),
      account_type: row.author_account_type,
    },
    /**
     * Das geteilte Event. `activity_id` ist null, wenn es inzwischen geloescht
     * wurde – der Titel bleibt trotzdem stehen (Schnappschuss, siehe
     * schema.sql), damit im Verlauf nicht eine leere Karte haengt.
     */
    shared: row.shared_title
      ? {
          activity_id: row.shared_activity_id ?? null,
          title: row.activity_title ?? row.shared_title,
          location: row.activity_location ?? null,
          starts_at: toIso(row.activity_starts_at ?? null),
          // `mediaUrl`, weil `banner_path` auch eine fremde Adresse enthalten
          // kann (importierte Events, siehe routes/activities.js).
          banner_url: mediaUrl(req, row.activity_banner),
        }
      : null,
  };
}

/**
 * Nachrichten eines Raums.
 *
 * Immer aufsteigend zurueck (aelteste zuerst) – so, wie ein Chat gelesen wird.
 * Fuer die aeltere Seite (`before`) muss die Datenbank absteigend sortieren, weil
 * sonst `LIMIT` die falschen Zeilen nimmt; die Liste wird danach gedreht.
 */
async function loadMessages(req, roomId, userId, { after, before, limit }) {
  if (!roomId) return [];

  const filters = [roomId];
  let where = 'm.room_id = ?';

  if (after) {
    where += ' AND m.id > ?';
    filters.push(after);
  }
  if (before) {
    where += ' AND m.id < ?';
    filters.push(before);
  }

  // Messages of anyone in a block relation with me disappear for me, in both directions (F-13):
  // whoever blocked and whoever was blocked no longer read each other in a shared room. Only for
  // the two of them: the others in the room still see both, because a block is a view and not
  // the deletion of someone else's message.
  const descending = Boolean(before) && !after;
  const [rows] = await pool.query(
    `SELECT m.id, m.user_id, m.body, m.created_at, m.shared_activity_id, m.shared_title,
            ${AUTHOR_COLUMNS},
            a.title AS activity_title, a.location AS activity_location,
            a.starts_at AS activity_starts_at, a.banner_path AS activity_banner
       FROM chat_messages m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN activities a ON a.id = m.shared_activity_id
      WHERE ${where}
        AND ${notBlockedWith('m.user_id')}
      ORDER BY m.id ${descending ? 'DESC' : 'ASC'}
      LIMIT ?`,
    // Reihenfolge der Platzhalter: die des WHERE, dann der Blockier-Vergleich
    // (zweimal die eigene ID), dann das Limit.
    [...filters, userId, userId, limit],
  );

  const ordered = descending ? rows.reverse() : rows;
  return ordered.map((row) => transformMessage(req, row, userId));
}

// GET /api/chats  (geschuetzt) – alle Chats mit letzter Nachricht und Ungelesenen.
//
// Listet Gruppen und Events auch dann, wenn noch nichts geschrieben wurde: Genau
// das ist die Einladung, den ersten Satz zu schreiben.
router.get('/chats', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;

    const [groups] = await pool.query(
      `SELECT g.id, g.name,
              (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS members
         FROM friend_groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
        ORDER BY g.name ASC`,
      [me],
    );

    // Nur Events, die noch nicht vorbei sind: Ein Chat zu einem Grillfest von
    // vor drei Monaten ist kein Gespraech mehr, das jemand fuehren will.
    const [activities] = await pool.query(
      `SELECT a.id, a.title, a.starts_at,
              (SELECT COUNT(*) FROM activity_user x WHERE x.activity_id = a.id) AS members
         FROM activities a
         JOIN activity_user au ON au.activity_id = a.id AND au.user_id = ?
        WHERE a.starts_at IS NULL OR a.starts_at > (NOW() - INTERVAL 1 DAY)
        ORDER BY a.starts_at ASC`,
      [me],
    );

    const chats = [
      ...groups.map((g) => ({
        kind: 'group',
        ref_id: g.id,
        title: g.name,
        members: Number(g.members),
        starts_at: null,
      })),
      ...activities.map((a) => ({
        kind: 'activity',
        ref_id: a.id,
        title: a.title,
        members: Number(a.members),
        starts_at: toIso(a.starts_at),
      })),
    ];

    if (chats.length === 0) return res.json({ data: [] });

    // Raeume der beiden Arten in EINER Abfrage holen – sonst waere das je Chat
    // eine eigene.
    const groupIds = groups.map((g) => g.id);
    const activityIds = activities.map((a) => a.id);
    const [rooms] = await pool.query(
      `SELECT id, kind, group_id, activity_id FROM chat_rooms
        WHERE (group_id IN (${groupIds.length ? groupIds.map(() => '?').join(',') : 'NULL'}))
           OR (activity_id IN (${activityIds.length ? activityIds.map(() => '?').join(',') : 'NULL'}))`,
      [...groupIds, ...activityIds],
    );

    const roomIdFor = new Map(
      rooms.map((room) => [`${room.kind}:${room.group_id ?? room.activity_id}`, room.id]),
    );
    const roomIds = rooms.map((room) => room.id);

    const lastByRoom = new Map();
    const unreadByRoom = new Map();

    if (roomIds.length > 0) {
      const ph = roomIds.map(() => '?').join(',');

      // Letzte Nachricht je Raum: erst die hoechste ID pro Raum, dann diese
      // Zeilen holen. Ein Fenster-Ausdruck waere kuerzer, laeuft aber nicht auf
      // aelteren MariaDB-Staenden.
      // It is the last message I may see: none of someone in a block relation with me (F-13),
      // the same rule as in the room itself (loadMessages).
      const [lastRows] = await pool.query(
        `SELECT m.room_id, m.body, m.created_at, m.shared_title, u.name
           FROM chat_messages m
           JOIN users u ON u.id = m.user_id
          WHERE m.id IN (SELECT MAX(m2.id) FROM chat_messages m2
                          WHERE m2.room_id IN (${ph}) AND ${notBlockedWith('m2.user_id')}
                          GROUP BY m2.room_id)`,
        [...roomIds, me, me],
      );
      lastRows.forEach((row) => {
        lastByRoom.set(row.room_id, {
          // Beim reinen Teilen ist der Text leer – dann steht der Event-Titel da,
          // sonst waere die Zeile in der Uebersicht leer.
          preview: row.body || (row.shared_title ? `Event: ${row.shared_title}` : ''),
          author: row.name,
          created_at: toIso(row.created_at),
        });
      });

      // Ungelesen = alles nach meinem Lesestand, ohne meine eigenen Nachrichten
      // und ohne die von Konten, mit denen eine Blockierung besteht (beide Richtungen, F-13).
      const [unreadRows] = await pool.query(
        `SELECT m.room_id, COUNT(*) AS c
           FROM chat_messages m
           LEFT JOIN chat_reads r ON r.room_id = m.room_id AND r.user_id = ?
          WHERE m.room_id IN (${ph})
            AND m.user_id <> ?
            AND m.id > COALESCE(r.last_read_id, 0)
            AND ${notBlockedWith('m.user_id')}
          GROUP BY m.room_id`,
        [me, ...roomIds, me, me, me],
      );
      unreadRows.forEach((row) => unreadByRoom.set(row.room_id, Number(row.c)));
    }

    const data = chats.map((chat) => {
      const roomId = roomIdFor.get(`${chat.kind}:${chat.ref_id}`) ?? null;
      const last = roomId ? lastByRoom.get(roomId) ?? null : null;
      return {
        ...chat,
        last_message: last,
        unread: roomId ? unreadByRoom.get(roomId) ?? 0 : 0,
      };
    });

    // Wo etwas los ist, steht oben: erst Ungelesenes, dann nach letzter
    // Nachricht, dann die stillen Chats.
    data.sort((a, b) => {
      if ((b.unread > 0) !== (a.unread > 0)) return b.unread - a.unread;
      const at = a.last_message?.created_at ?? '';
      const bt = b.last_message?.created_at ?? '';
      if (at !== bt) return bt.localeCompare(at);
      return a.title.localeCompare(b.title);
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/chats/:kind/:refId/messages  (geschuetzt)
router.get('/chats/:kind/:refId/messages', requireAuth, async (req, res, next) => {
  try {
    if (!isRoomKind(req.params.kind)) throw new HttpError(404, 'Diesen Chat gibt es nicht.');
    const room = await loadRoomForMember(req.params.kind, req.params.refId, req.user);

    const after = Number(req.query.after) || 0;
    const before = Number(req.query.before) || 0;
    const data = await loadMessages(req, room.roomId, req.user.id, {
      after: after > 0 ? after : null,
      before: before > 0 ? before : null,
      limit: pageLimit(req.query.limit),
    });

    res.json({
      data,
      room: {
        kind: room.kind,
        ref_id: room.refId,
        title: room.title,
        can_moderate: room.canModerate,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chats/:kind/:refId/messages  (geschuetzt) – Text und/oder Event teilen.
router.post('/chats/:kind/:refId/messages', requireAuth, rateLimit('chat'), async (req, res, next) => {
  try {
    if (!isRoomKind(req.params.kind)) throw new HttpError(404, 'Diesen Chat gibt es nicht.');
    const room = await loadRoomForMember(req.params.kind, req.params.refId, req.user);

    const parsed = parseMessageInput(req.body);
    if (parsed.error) throw new HttpError(422, parsed.error, { body: [parsed.error] });

    // Gesperrte Begriffe: klar ablehnen statt maskieren. Ein „***" im Verlauf
    // sagte allen, dass da etwas stand – und dem Absender nicht, was.
    // The stored text, and the value as it came when it was not a string (F-06).
    if (
      (parsed.body && findBlockedTerm(parsed.body, BLOCKED_TERMS, 'text')) ||
      (typeof req.body?.body !== 'string' && findBlockedTermInValue(req.body?.body, BLOCKED_TERMS, 'text'))
    ) {
      const message = blockedTermMessageFor('text');
      throw new HttpError(422, message, { body: [message] });
    }

    checkBurst(req.user.id);

    // Schnappschuss des geteilten Events. Gibt es das Event nicht, ist das ein
    // 422 und keine Nachricht mit leerer Karte.
    let sharedTitle = null;
    if (parsed.sharedActivityId) {
      const activity = await first('SELECT id, title FROM activities WHERE id = ?', [
        parsed.sharedActivityId,
      ]);
      if (!activity) {
        throw new HttpError(422, 'Dieses Event gibt es nicht mehr.', {
          activity_id: ['Dieses Event gibt es nicht mehr.'],
        });
      }
      sharedTitle = activity.title;
    }

    const roomId = room.roomId ?? (await ensureRoom(room.kind, room.refId));

    const [result] = await pool.query(
      `INSERT INTO chat_messages (room_id, user_id, body, shared_activity_id, shared_title, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [roomId, req.user.id, parsed.body, parsed.sharedActivityId, sharedTitle],
    );

    // Was man selbst schreibt, hat man gelesen – sonst zeigte die Uebersicht dem
    // Absender eine ungelesene Nachricht an, sobald jemand anderes antwortet.
    await pool.query(
      `INSERT INTO chat_reads (room_id, user_id, last_read_id, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id)),
                               updated_at = NOW()`,
      [roomId, req.user.id, result.insertId],
    );

    const [rows] = await pool.query(
      `SELECT m.id, m.user_id, m.body, m.created_at, m.shared_activity_id, m.shared_title,
              ${AUTHOR_COLUMNS},
              a.title AS activity_title, a.location AS activity_location,
              a.starts_at AS activity_starts_at, a.banner_path AS activity_banner
         FROM chat_messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN activities a ON a.id = m.shared_activity_id
        WHERE m.id = ?`,
      [result.insertId],
    );

    res.status(201).json({ data: transformMessage(req, rows[0], req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/chats/:kind/:refId/read  (geschuetzt) – Lesestand setzen.
//
// `GREATEST` sorgt dafuer, dass der Stand nie zuruecklaeuft: Zwei Geraete, die
// verschieden weit gelesen haben, wuerden sich sonst gegenseitig zuruecksetzen.
router.post('/chats/:kind/:refId/read', requireAuth, rateLimit('state'), async (req, res, next) => {
  try {
    if (!isRoomKind(req.params.kind)) throw new HttpError(404, 'Diesen Chat gibt es nicht.');
    const room = await loadRoomForMember(req.params.kind, req.params.refId, req.user);
    if (!room.roomId) return res.json({ unread: 0 });

    const upTo = Number(req.body?.message_id) || 0;
    const target =
      upTo > 0
        ? upTo
        : Number(
            (await first('SELECT MAX(id) AS last FROM chat_messages WHERE room_id = ?', [room.roomId]))
              ?.last ?? 0,
          );

    await pool.query(
      `INSERT INTO chat_reads (room_id, user_id, last_read_id, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id)),
                               updated_at = NOW()`,
      [room.roomId, req.user.id, target],
    );

    res.json({ unread: 0 });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chats/messages/:id  (geschuetzt)
//
// Erlaubt fuer die:den Absender:in – und fuer wen den Ort verantwortet (Gruppe
// angelegt, Event veranstaltet) sowie fuer Admins. Genau das war eine der
// Beschwerden ueber vergleichbare Apps: Nachrichten, die fuer immer stehen
// bleiben, auch wenn sie nicht stehen bleiben sollten.
router.delete('/chats/messages/:id', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const message = await first(
      `SELECT m.id, m.user_id, r.kind, r.group_id, r.activity_id
         FROM chat_messages m
         JOIN chat_rooms r ON r.id = m.room_id
        WHERE m.id = ?`,
      [Number(req.params.id) || 0],
    );
    if (!message) throw new HttpError(404, 'Diese Nachricht gibt es nicht.');

    // Ueber `loadRoomForMember` gehen, statt die Rechte hier ein zweites Mal zu
    // formulieren: Wer nicht im Raum ist, bekommt dadurch dasselbe 404 wie beim
    // Lesen und erfaehrt nichts ueber eine fremde Nachricht.
    const room = await loadRoomForMember(
      message.kind,
      message.group_id ?? message.activity_id,
      req.user,
    );

    if (message.user_id !== req.user.id && !room.canModerate) {
      throw new HttpError(403, 'Du kannst nur eigene Nachrichten loeschen.');
    }

    await pool.query('DELETE FROM chat_messages WHERE id = ?', [message.id]);
    res.json({ message: 'Nachricht geloescht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
