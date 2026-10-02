/**
 * Gruppen im Freunde-Bereich.
 *
 * Stand vorher in `routes/friends.js`. Herausgeloest, weil dort inzwischen zwei
 * Dinge lagen, die nur einen Namen teilen: Freundschaften sind eine Beziehung
 * zwischen zwei Konten, eine Gruppe ist ein Ort mit Mitgliedern und – seit dem
 * Chat – mit einem Gespraech darin. Was beide brauchen, steht in `src/people.js`.
 *
 * ## Warum Gruppen Freundschaften voraussetzen
 *
 * Aufnehmen darf nur die:der Anlegende und nur bestaetigte Freunde – sonst waere
 * „Gruppe" der Weg, jemanden ohne Zustimmung in eine Liste zu ziehen. Seit die
 * Gruppe einen Chat hat, waere es zusaetzlich der Weg, ungefragt in jemandes
 * Nachrichten aufzutauchen.
 *
 * Verlassen darf jede:r selbst; die:der Anlegende verlaesst die Gruppe, indem
 * sie:er sie loescht (dann ist sie fuer alle weg, statt fuehrerlos
 * zurueckzubleiben).
 */
import { createRouter } from '../router.js';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError, Validator } from '../validate.js';
import { rejectBlockedTerms } from '../blocked-terms.js';
import {
  USER_COLUMNS,
  areFriends,
  blockExistsBetween,
  loadUser,
  notBlockedWith,
  transformUser,
} from '../people.js';

const router = createRouter();

/** Wie viele Mitglieder eine Gruppe fasst – inklusive Anlegende:r. */
const MAX_GROUP_MEMBERS = 50;

/** Laenge des Gruppennamens; gleiche Zahl wie die Spalte in schema.sql. */
const MAX_GROUP_NAME = 60;

/** Laenge der Beschreibung; gleiche Zahl wie die Spalte in schema.sql. */
const MAX_GROUP_DESCRIPTION = 200;

/**
 * Gruppenname gegen die Liste gesperrter Begriffe – im Modus 'name', nicht
 * 'text': Der Name ist eine Selbstbezeichnung wie ein Anzeigename und steht in
 * jeder Mitgliederliste und ueber dem Gruppenchat. „Hitler-Fanclub" gehoert dort
 * so wenig hin wie im Profil. Die Meldung („Dieser Name ist nicht erlaubt.")
 * passt auch hier woertlich.
 */
function rejectGroupName(v, name) {
  rejectBlockedTerms(v, 'name', name, 'name');
}

/**
 * Mitglieder einer Gruppe (Anlegende:r zuerst), as `viewerId` sees them: someone in a block
 * relation with the viewer is left out (F-13). A block between two members of someone else's
 * group does not remove either of them (the room belongs to its owner), so it hides them from
 * each other here and in the chat (routes/chat.js).
 */
async function membersOf(req, groupId, ownerId, viewerId) {
  const [rows] = await pool.query(
    `SELECT ${USER_COLUMNS} FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ? AND ${notBlockedWith('u.id')}
      ORDER BY (u.id = ?) DESC, u.name ASC`,
    [groupId, viewerId, viewerId, ownerId],
  );
  return rows.map((row) => transformUser(req, row));
}

/** Die Gruppe – aber nur, wenn man selbst drin ist. */
async function loadGroupForMember(groupId, userId) {
  const group = await first(
    `SELECT g.id, g.owner_id, g.name, g.description, g.created_at
       FROM friend_groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
      WHERE g.id = ?`,
    [userId, Number(groupId) || 0],
  );
  // 404 und nicht 403: Wer nicht drin ist, soll nicht erfahren, dass es die
  // Gruppe gibt.
  if (!group) throw new HttpError(404, 'Diese Gruppe gibt es nicht.');
  return group;
}

/**
 * Ungelesene Nachrichten je Gruppe – in EINER Abfrage fuer alle Gruppen.
 *
 * Steckt hier und nicht in `routes/chat.js`, weil die Gruppenliste die Zahl
 * braucht: Ohne sie muesste die App beide Listen laden, nur um am Gruppen-Eintrag
 * einen Punkt anzuzeigen.
 */
async function unreadByGroup(groupIds, userId) {
  if (groupIds.length === 0) return new Map();
  const ph = groupIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT r.group_id, COUNT(m.id) AS c
       FROM chat_rooms r
       JOIN chat_messages m ON m.room_id = r.id
       LEFT JOIN chat_reads cr ON cr.room_id = r.id AND cr.user_id = ?
      WHERE r.group_id IN (${ph})
        AND m.user_id <> ?
        AND m.id > COALESCE(cr.last_read_id, 0)
        AND ${notBlockedWith('m.user_id')}
      GROUP BY r.group_id`,
    [userId, ...groupIds, userId, userId, userId],
  );
  return new Map(rows.map((row) => [row.group_id, Number(row.c)]));
}

async function transformGroup(req, group, userId, unread = 0) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    created_at: toIso(group.created_at),
    is_owner: group.owner_id === userId,
    members: await membersOf(req, group.id, group.owner_id, userId),
    /** Ungelesene Nachrichten im Gruppen-Chat – der Punkt am Eintrag. */
    unread,
  };
}

// GET /api/groups  (geschuetzt) – eigene Gruppen und die, in denen man Mitglied ist.
router.get('/groups', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.owner_id, g.name, g.description, g.created_at
         FROM friend_groups g
         JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
        ORDER BY g.created_at DESC, g.id DESC`,
      [req.user.id],
    );

    const unread = await unreadByGroup(
      rows.map((row) => row.id),
      req.user.id,
    );
    const data = await Promise.all(
      rows.map((row) => transformGroup(req, row, req.user.id, unread.get(row.id) ?? 0)),
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups  (geschuetzt) – Gruppe anlegen; die:der Anlegende ist drin.
router.post('/groups', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const v = new Validator(req.body ?? {});

    // The word filter gets the values as they came, any JSON type (F-06).
    if (!name) v.add('name', 'Gib der Gruppe einen Namen.');
    else if (name.length > MAX_GROUP_NAME) {
      v.add('name', `Der Name fasst hoechstens ${MAX_GROUP_NAME} Zeichen.`);
    } else rejectGroupName(v, req.body?.name);
    if (description.length > MAX_GROUP_DESCRIPTION) {
      v.add('description', `Die Beschreibung fasst hoechstens ${MAX_GROUP_DESCRIPTION} Zeichen.`);
    } else rejectBlockedTerms(v, 'description', req.body?.description, 'text');
    v.throwIfFails();

    // Mitglieder, die direkt mit angelegt werden – nur bestaetigte Freunde.
    const wanted = Array.isArray(req.body?.members)
      ? req.body.members.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];

    const connection = await pool.getConnection();
    let groupId;
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        `INSERT INTO friend_groups (owner_id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [req.user.id, name, description || null],
      );
      groupId = result.insertId;
      await connection.query(
        `INSERT INTO group_members (group_id, user_id, created_at) VALUES (?, ?, NOW())`,
        [groupId, req.user.id],
      );
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    // Die Mitglieder erst nach dem Anlegen: So entsteht die Gruppe auch dann,
    // wenn eine der IDs inzwischen keine Freundschaft mehr ist – sie fehlt dann
    // in der Liste, statt das Anlegen scheitern zu lassen.
    for (const id of wanted.slice(0, MAX_GROUP_MEMBERS - 1)) {
      if (id === req.user.id) continue;
      if (!(await areFriends(req.user.id, id))) continue;
      // The same second lock as POST /groups/:id/members: a block ends the friendship, but a
      // friendship row must never be the only thing that keeps a blocked person out (F-13).
      if (await blockExistsBetween(req.user.id, id)) continue;
      await pool.query(
        `INSERT IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?, ?, NOW())`,
        [groupId, id],
      );
    }

    const group = await loadGroupForMember(groupId, req.user.id);
    res.status(201).json({ data: await transformGroup(req, group, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/groups/:id  (geschuetzt, nur Anlegende:r) – Name und Beschreibung.
//
// Neu mit dem Chat: Eine Gruppe, in der geredet wird, ueberlebt ihren ersten
// Anlass. „Kickerrunde" heisst dann irgendwann „Donnerstagsrunde", und dafuer
// muss man sie nicht neu anlegen und alle neu aufnehmen.
router.patch('/groups/:id', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const group = await loadGroupForMember(req.params.id, req.user.id);
    if (group.owner_id !== req.user.id) {
      throw new HttpError(403, 'Nur wer die Gruppe angelegt hat, kann sie umbenennen.');
    }

    const v = new Validator(req.body ?? {});
    const hasName = req.body?.name !== undefined;
    const hasDescription = req.body?.description !== undefined;
    const name = hasName ? String(req.body.name).trim() : group.name;
    const description = hasDescription
      ? String(req.body.description).trim()
      : group.description ?? '';

    if (hasName) {
      if (!name) v.add('name', 'Gib der Gruppe einen Namen.');
      else if (name.length > MAX_GROUP_NAME) {
        v.add('name', `Der Name fasst hoechstens ${MAX_GROUP_NAME} Zeichen.`);
      } else if (name !== group.name) rejectGroupName(v, req.body.name);
    }
    // Nur NEUE Werte pruefen (wie beim Profil): Ein Altname, den die Liste heute
    // traefe, soll das Aendern der Beschreibung nicht blockieren – und umgekehrt.
    if (hasDescription && description.length > MAX_GROUP_DESCRIPTION) {
      v.add('description', `Die Beschreibung fasst hoechstens ${MAX_GROUP_DESCRIPTION} Zeichen.`);
    } else if (hasDescription && description !== (group.description ?? '')) {
      rejectBlockedTerms(v, 'description', req.body.description, 'text');
    }
    v.throwIfFails();

    await pool.query(
      'UPDATE friend_groups SET name = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [name, description || null, group.id],
    );

    const updated = await loadGroupForMember(group.id, req.user.id);
    res.json({ data: await transformGroup(req, updated, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:id/members  (geschuetzt, nur Anlegende:r) – Freund:in aufnehmen.
router.post('/groups/:id/members', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const group = await loadGroupForMember(req.params.id, req.user.id);
    if (group.owner_id !== req.user.id) {
      throw new HttpError(403, 'Nur wer die Gruppe angelegt hat, kann Leute aufnehmen.');
    }

    const other = await loadUser(req.body?.user_id);
    if (!(await areFriends(req.user.id, other.id))) {
      throw new HttpError(422, 'In eine Gruppe kommen nur bestaetigte Freunde.', {
        user_id: ['In eine Gruppe kommen nur bestaetigte Freunde.'],
      });
    }

    // Sollte durch die Freundschafts-Pruefung schon ausgeschlossen sein
    // (Blockieren loest die Freundschaft). Der Riegel steht trotzdem hier: Er ist
    // billig, und ein Gruppen-Chat ist genau der Ort, an dem ein Fehler in dieser
    // Kette teuer waere.
    if (await blockExistsBetween(req.user.id, other.id)) {
      throw new HttpError(422, 'Mit diesem Konto ist kein Kontakt moeglich.');
    }

    const count = await first('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?', [group.id]);
    if (Number(count?.c ?? 0) >= MAX_GROUP_MEMBERS) {
      throw new HttpError(422, `Eine Gruppe fasst ${MAX_GROUP_MEMBERS} Leute.`);
    }

    await pool.query(
      `INSERT IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?, ?, NOW())`,
      [group.id, other.id],
    );
    res.json({ data: await transformGroup(req, group, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id/members/:userId  (geschuetzt) – jemanden entfernen oder
// selbst gehen. Die:der Anlegende kann nicht gehen, ohne die Gruppe zu loeschen.
router.delete('/groups/:id/members/:userId', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const group = await loadGroupForMember(req.params.id, req.user.id);
    const targetId = Number(req.params.userId) || 0;
    const isSelf = targetId === req.user.id;

    if (!isSelf && group.owner_id !== req.user.id) {
      throw new HttpError(403, 'Nur wer die Gruppe angelegt hat, kann Leute entfernen.');
    }
    if (targetId === group.owner_id) {
      throw new HttpError(422, 'Loesche die Gruppe, wenn du sie nicht mehr brauchst.');
    }

    await pool.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [
      group.id,
      targetId,
    ]);

    // Der Lesestand geht mit: Wer wieder aufgenommen wird, soll nicht auf einem
    // Stand von vor Monaten sitzen und die Nachrichten dazwischen als ungelesen
    // vor sich haben.
    await pool.query(
      `DELETE cr FROM chat_reads cr
         JOIN chat_rooms r ON r.id = cr.room_id
        WHERE r.group_id = ? AND cr.user_id = ?`,
      [group.id, targetId],
    );

    if (isSelf) return res.json({ message: 'Gruppe verlassen.' });
    res.json({ data: await transformGroup(req, group, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id  (geschuetzt, nur Anlegende:r) – Gruppe loeschen.
router.delete('/groups/:id', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const group = await loadGroupForMember(req.params.id, req.user.id);
    if (group.owner_id !== req.user.id) {
      throw new HttpError(403, 'Nur wer die Gruppe angelegt hat, kann sie loeschen.');
    }
    // Mitgliedschaften, Chat-Raum und Nachrichten raeumt die DB per
    // ON DELETE CASCADE (siehe schema.sql).
    await pool.query('DELETE FROM friend_groups WHERE id = ?', [group.id]);
    res.json({ message: 'Gruppe geloescht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
