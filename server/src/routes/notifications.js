/**
 * Benachrichtigungen lesen und abhaken.
 *
 * Geschrieben wird hier nichts – das tun die Stellen, an denen etwas passiert
 * (stories.js, activities.js, profile.js, friends.js) ueber `notifications.js`.
 * Dieser Router ist nur der Briefkasten.
 *
 * ## Warum „alles gelesen" und nicht „diese eine"
 *
 * Es gibt beides, aber der Hauptweg ist das Abhaken der ganzen Liste beim
 * Oeffnen: Man liest Benachrichtigungen als Stapel, nicht einzeln. Eine Liste, in
 * der nach dem Durchscrollen noch neun als ungelesen stehen, ist eine Liste, die
 * ihren Zaehler nie wieder loswird. Einzeln abhaken gibt es fuer den Fall, dass
 * man genau eine antippt und wegspringt.
 */
import { createRouter } from '../router.js';
import { pool, first } from '../db.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError } from '../validate.js';
import { NOTIFICATION_LIMIT, transformNotification } from '../notifications.js';

const router = createRouter();

// GET /api/notifications  (geschuetzt) – neueste zuerst, dazu der Ungelesen-Zaehler.
router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.id, n.type, n.ref_id, n.title, n.body, n.read_at, n.created_at,
              n.actor_id,
              a.name AS actor_name, a.username AS actor_username,
              a.avatar AS actor_avatar, a.account_type AS actor_account_type
         FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
        WHERE n.user_id = ?
        ORDER BY n.id DESC
        LIMIT ${NOTIFICATION_LIMIT}`,
      [req.user.id],
    );

    // Der Zaehler zaehlt ALLE ungelesenen, nicht nur die auf dieser Seite: Sonst
    // stuende bei 80 ungelesenen eine 60 an der Glocke.
    const unread = await first(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id],
    );

    res.json({
      data: rows.map((row) => transformNotification(req, row)),
      unread: Number(unread?.n ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read  (geschuetzt) – alles abhaken.
router.post('/notifications/read', requireAuth, rateLimit('state'), async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL',
      [req.user.id],
    );
    res.json({ unread: 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read  (geschuetzt) – eine einzelne abhaken.
router.post('/notifications/:id/read', requireAuth, rateLimit('state'), async (req, res, next) => {
  try {
    const row = await first('SELECT id, user_id FROM notifications WHERE id = ?', [req.params.id]);
    // Fremde Benachrichtigung: 404 statt 403 – dass es sie gibt, geht niemanden an.
    if (!row || Number(row.user_id) !== Number(req.user.id)) {
      throw new HttpError(404, 'Diese Benachrichtigung gibt es nicht.');
    }

    await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = ? AND read_at IS NULL', [
      row.id,
    ]);

    const unread = await first(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [req.user.id],
    );
    res.json({ unread: Number(unread?.n ?? 0) });
  } catch (err) {
    next(err);
  }
});

export default router;
