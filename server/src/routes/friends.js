/**
 * Freundschaften und Blockierungen.
 *
 * Die Gruppen sind seit dem Chat in `routes/groups.js` umgezogen: In dieser Datei
 * lagen zwei Dinge, die nur einen Namen teilen. Was beide brauchen – „gibt es
 * dieses Konto", „sind die beiden befreundet", „hat eine:r blockiert" – steht in
 * `src/people.js`.
 *
 * ## Eine Zeile pro Freundschaft, zwei Richtungen beim Blockieren
 *
 * Warum das so ist, steht in `src/people.js`. Kurz: Eine Freundschaft kann nie
 * halb bestehen, weil es nur eine Zeile gibt. Beim Blockieren ist die Richtung
 * dagegen der Inhalt, also gibt es eine Zeile je Richtung.
 *
 * ## Blockieren beendet die Freundschaft
 *
 * Nicht nur „keine Anfragen mehr": Wer blockiert, ist auch nicht mehr befreundet
 * und nicht mehr in den gemeinsamen Gruppen. Sonst bliebe die Person im
 * Gruppen-Chat sitzen und wuerde weiterlesen – und „blockiert" waere eine Anzeige
 * ohne Wirkung.
 */
import { Router } from 'express';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError } from '../validate.js';
import {
  USER_COLUMNS,
  blockExistsBetween,
  dropSharedGroupMemberships,
  existingBetween,
  loadUser,
  transformUser,
} from '../people.js';

const router = Router();

// GET /api/friends  (geschuetzt) – Freunde, eingehende und offene Anfragen.
router.get('/friends', requireAuth, async (req, res, next) => {
  try {
    const me = req.user.id;

    const [accepted] = await pool.query(
      `SELECT ${USER_COLUMNS}, f.created_at AS since
         FROM friendships f
         JOIN users u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
        WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?)
        ORDER BY u.name ASC`,
      [me, me, me],
    );

    const [incoming] = await pool.query(
      `SELECT ${USER_COLUMNS}, f.created_at AS since
         FROM friendships f JOIN users u ON u.id = f.requester_id
        WHERE f.status = 'pending' AND f.addressee_id = ?
        ORDER BY f.id DESC`,
      [me],
    );

    const [outgoing] = await pool.query(
      `SELECT ${USER_COLUMNS}, f.created_at AS since
         FROM friendships f JOIN users u ON u.id = f.addressee_id
        WHERE f.status = 'pending' AND f.requester_id = ?
        ORDER BY f.id DESC`,
      [me],
    );

    const withSince = (rows) =>
      rows.map((row) => ({ ...transformUser(req, row), since: toIso(row.since) }));

    res.json({
      friends: withSince(accepted),
      incoming: withSince(incoming),
      outgoing: withSince(outgoing),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/friends  (geschuetzt) – anfragen oder eine Anfrage annehmen.
//
// Ein Endpunkt fuer beides, weil es aus Sicht der App dieselbe Handlung ist:
// „Ich will mit dieser Person befreundet sein." Liegt schon eine Anfrage in die
// andere Richtung vor, ist die Antwort darauf ein Ja – und nicht eine zweite,
// gekreuzte Anfrage, auf die dann beide warten.
router.post('/friends', requireAuth, async (req, res, next) => {
  try {
    const other = await loadUser(req.body?.user_id);
    if (other.id === req.user.id) {
      throw new HttpError(422, 'Mit dir selbst bist du schon befreundet.', {
        user_id: ['Mit dir selbst bist du schon befreundet.'],
      });
    }

    // Beide Richtungen: Wer blockiert hat, will nicht angefragt werden – und wer
    // blockiert wurde, soll nicht anfragen koennen. Die Meldung ist fuer beide
    // Seiten dieselbe und nennt keinen Grund: Sonst waere sie die Auskunft
    // „du wurdest blockiert".
    if (await blockExistsBetween(req.user.id, other.id)) {
      throw new HttpError(422, 'Mit diesem Konto ist kein Kontakt moeglich.', {
        user_id: ['Mit diesem Konto ist kein Kontakt moeglich.'],
      });
    }

    const existing = await existingBetween(req.user.id, other.id);

    if (existing?.status === 'accepted') {
      return res.json({ status: 'accepted', user: transformUser(req, other) });
    }

    if (existing?.status === 'pending') {
      // Anfrage kam von der anderen Seite → annehmen.
      if (existing.addressee_id === req.user.id) {
        await pool.query(
          `UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = ?`,
          [existing.id],
        );
        return res.json({ status: 'accepted', user: transformUser(req, other) });
      }
      // Eigene Anfrage lag schon vor – nichts zu tun, aber auch kein Fehler.
      return res.json({ status: 'pending', user: transformUser(req, other) });
    }

    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, 'pending', NOW(), NOW())`,
      [req.user.id, other.id],
    );
    res.status(201).json({ status: 'pending', user: transformUser(req, other) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/friends/:userId  (geschuetzt) – Freundschaft beenden, Anfrage
// zuruecknehmen oder ablehnen. Alles dasselbe: die Zeile ist weg.
router.delete('/friends/:userId', requireAuth, async (req, res, next) => {
  try {
    const existing = await existingBetween(req.user.id, Number(req.params.userId) || 0);
    if (!existing) throw new HttpError(404, 'Da ist keine Verbindung.');

    await pool.query('DELETE FROM friendships WHERE id = ?', [existing.id]);

    // Mit der Freundschaft geht die Gruppen-Mitgliedschaft (siehe src/people.js).
    const otherId =
      existing.requester_id === req.user.id ? existing.addressee_id : existing.requester_id;
    await dropSharedGroupMemberships(req.user.id, otherId);

    res.json({ message: 'Verbindung entfernt.' });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------- Blockieren */

// GET /api/blocks  (geschuetzt) – wen ich blockiert habe.
//
// Es gibt diese Liste, weil Blockieren sonst nicht rueckgaengig zu machen waere:
// Die Person verschwindet ueberall aus der App, also auch aus jeder Ansicht, in
// der man sie wieder freigeben koennte.
router.get('/blocks', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ${USER_COLUMNS}, b.created_at AS since
         FROM user_blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = ?
        ORDER BY b.created_at DESC`,
      [req.user.id],
    );
    res.json({
      data: rows.map((row) => ({ ...transformUser(req, row), since: toIso(row.since) })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/blocks  (geschuetzt) – Konto blockieren.
router.post('/blocks', requireAuth, async (req, res, next) => {
  try {
    const other = await loadUser(req.body?.user_id);
    if (other.id === req.user.id) {
      throw new HttpError(422, 'Dich selbst kannst du nicht blockieren.', {
        user_id: ['Dich selbst kannst du nicht blockieren.'],
      });
    }

    await pool.query(
      'INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, NOW())',
      [req.user.id, other.id],
    );

    // Blockieren beendet die Verbindung: Freundschaft weg, gemeinsame Gruppen weg.
    const existing = await existingBetween(req.user.id, other.id);
    if (existing) await pool.query('DELETE FROM friendships WHERE id = ?', [existing.id]);
    await dropSharedGroupMemberships(req.user.id, other.id);

    res.status(201).json({ message: 'Konto blockiert.', user: transformUser(req, other) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/blocks/:userId  (geschuetzt) – Blockierung aufheben.
//
// Die Freundschaft kommt dadurch NICHT zurueck: Sie war beendet, und ein
// Wiederherstellen waere eine Verbindung, der niemand neu zugestimmt hat.
router.delete('/blocks/:userId', requireAuth, async (req, res, next) => {
  try {
    const targetId = Number(req.params.userId) || 0;
    const row = await first(
      'SELECT 1 AS ok FROM user_blocks WHERE blocker_id = ? AND blocked_id = ? LIMIT 1',
      [req.user.id, targetId],
    );
    if (!row) throw new HttpError(404, 'Dieses Konto ist nicht blockiert.');

    await pool.query('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [
      req.user.id,
      targetId,
    ]);
    res.json({ message: 'Blockierung aufgehoben.' });
  } catch (err) {
    next(err);
  }
});

export default router;
