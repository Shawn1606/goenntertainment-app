/**
 * Meldungen: melden (jede:r) und bearbeiten (Admin).
 *
 * Warum es diesen Weg gibt, steht in `src/reports.js`. Kurz: Die
 * Nutzungsbedingungen erklaeren, dass die Inhalte von den Nutzer:innen kommen und
 * die Plattform fuer das Geschehen auf einem Event nicht haftet. Damit das nicht
 * bloss eine Erklaerung bleibt, braucht es einen Weg, von Problemen zu erfahren –
 * und eine Liste, auf der sie landen.
 *
 * ## Melden loescht nichts
 *
 * Eine Meldung ist ein Hinweis, keine Entscheidung. Sie entfernt nichts und
 * sperrt niemanden – das tut ein Admin, mit den Werkzeugen, die es dafuer schon
 * gibt (siehe `routes/admin.js`). Anders herum waere jede Meldung eine
 * Loeschtaste in fremder Hand.
 *
 * Wer nicht warten will, bis jemand hinsieht, blockiert das Konto: Das wirkt
 * sofort und nur fuer die eigene Sicht (siehe `routes/friends.js`). Beides
 * zusammen ist die ehrliche Antwort auf „was kann ich jetzt tun?".
 */
import { createRouter } from '../router.js';
import { pool, first, toIso } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError } from '../validate.js';
import { parseReportInput } from '../reports.js';
import { mediaUrl } from '../media.js';

const router = createRouter();

/**
 * Gibt es den gemeldeten Gegenstand ueberhaupt?
 *
 * Ohne diese Pruefung liesse sich die Liste mit erfundenen IDs zumuellen, und ein
 * Admin suchte hinterher nach Inhalten, die es nie gab.
 */
const TARGET_TABLES = {
  activity: 'activities',
  message: 'chat_messages',
  user: 'users',
  post: 'posts',
  story: 'stories',
};

async function targetExists(targetType, targetId) {
  const table = TARGET_TABLES[targetType];
  if (!table) return false;
  const row = await first(`SELECT 1 AS ok FROM ${table} WHERE id = ? LIMIT 1`, [targetId]);
  return Boolean(row);
}

// POST /api/reports  (geschuetzt) – etwas melden.
router.post('/reports', requireAuth, rateLimit('report'), async (req, res, next) => {
  try {
    const parsed = parseReportInput(req.body);
    if (parsed.error) throw new HttpError(422, parsed.error, { reason: [parsed.error] });

    if (parsed.targetType === 'user' && parsed.targetId === req.user.id) {
      throw new HttpError(422, 'Dich selbst zu melden bringt niemandem etwas.');
    }

    if (!(await targetExists(parsed.targetType, parsed.targetId))) {
      throw new HttpError(404, 'Das gibt es nicht mehr.');
    }

    // `ON DUPLICATE KEY UPDATE` statt eines Fehlers: Wer zweimal auf „melden"
    // tippt, hat nichts falsch gemacht. Der eindeutige Schluessel haelt die Liste
    // trotzdem frei von Dutzenden gleichen Zeilen; eine erneute Meldung
    // aktualisiert Grund und Schilderung und stellt sie zurueck auf offen.
    await pool.query(
      `INSERT INTO content_reports (reporter_id, target_type, target_id, reason, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', NOW())
       ON DUPLICATE KEY UPDATE reason = VALUES(reason),
                               note = VALUES(note),
                               status = 'open',
                               handled_by = NULL,
                               handled_at = NULL,
                               created_at = NOW()`,
      [req.user.id, parsed.targetType, parsed.targetId, parsed.reason, parsed.note],
    );

    res.status(201).json({
      message: 'Danke – wir sehen uns das an.',
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------- Admin */

/**
 * Laedt zu jeder Meldung eine kurze Beschreibung des Gegenstands.
 *
 * Gruppiert nach Art, damit daraus fuenf Abfragen werden und nicht eine je
 * Meldung. Fehlt der Gegenstand (geloescht), bleibt der Platz leer – die Meldung
 * bleibt trotzdem sichtbar, denn genau der geloeschte Inhalt ist manchmal der,
 * um den es hinterher geht.
 */
async function loadTargets(req, reports) {
  const byType = new Map();
  reports.forEach((report) => {
    if (!byType.has(report.target_type)) byType.set(report.target_type, new Set());
    byType.get(report.target_type).add(report.target_id);
  });

  const found = new Map();
  const remember = (type, id, value) => found.set(`${type}:${id}`, value);

  for (const [type, idSet] of byType) {
    const ids = [...idSet];
    const ph = ids.map(() => '?').join(',');

    if (type === 'activity') {
      const [rows] = await pool.query(
        `SELECT a.id, a.title, a.starts_at, a.banner_path, u.name AS author
           FROM activities a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.id IN (${ph})`,
        ids,
      );
      rows.forEach((row) =>
        remember(type, row.id, {
          label: row.title,
          author: row.author,
          detail: toIso(row.starts_at),
          // `mediaUrl`, weil `banner_path` auch eine fremde Adresse enthalten
          // kann (importierte Events, siehe routes/activities.js).
          image_url: mediaUrl(req, row.banner_path),
        }),
      );
    } else if (type === 'message') {
      const [rows] = await pool.query(
        `SELECT m.id, m.body, m.shared_title, u.name AS author
           FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.id IN (${ph})`,
        ids,
      );
      rows.forEach((row) =>
        remember(type, row.id, {
          label: row.body || (row.shared_title ? `Event: ${row.shared_title}` : ''),
          author: row.author,
          detail: null,
          image_url: null,
        }),
      );
    } else if (type === 'user') {
      const [rows] = await pool.query(
        `SELECT id, name, username FROM users WHERE id IN (${ph})`,
        ids,
      );
      rows.forEach((row) =>
        remember(type, row.id, {
          label: row.username ? `@${row.username}` : row.name,
          author: row.name,
          detail: null,
          image_url: null,
        }),
      );
    } else if (type === 'post') {
      const [rows] = await pool.query(
        `SELECT p.id, p.body, p.image_path, u.name AS author
           FROM posts p LEFT JOIN users u ON u.id = p.user_id
          WHERE p.id IN (${ph})`,
        ids,
      );
      rows.forEach((row) =>
        remember(type, row.id, {
          label: row.body,
          author: row.author,
          detail: null,
          image_url: mediaUrl(req, row.image_path),
        }),
      );
    } else if (type === 'story') {
      const [rows] = await pool.query(
        `SELECT s.id, s.caption, s.image_path, u.name AS author
           FROM stories s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.id IN (${ph})`,
        ids,
      );
      rows.forEach((row) =>
        remember(type, row.id, {
          label: row.caption ?? '(ohne Text)',
          author: row.author,
          detail: null,
          image_url: mediaUrl(req, row.image_path),
        }),
      );
    }
  }

  return found;
}

// GET /api/admin/reports  (nur Admin) – offene Meldungen zuerst.
router.get('/admin/reports', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.status,
              r.handled_at, r.created_at,
              reporter.name AS reporter_name, reporter.username AS reporter_username,
              admin.name AS admin_name
         FROM content_reports r
         LEFT JOIN users reporter ON reporter.id = r.reporter_id
         LEFT JOIN users admin ON admin.id = r.handled_by
        ORDER BY (r.status = 'open') DESC, r.created_at DESC
        LIMIT 300`,
    );

    const targets = await loadTargets(req, rows);
    const openRow = await first(
      `SELECT COUNT(*) AS c FROM content_reports WHERE status = 'open'`,
    );

    res.json({
      open: Number(openRow?.c ?? 0),
      data: rows.map((row) => ({
        id: row.id,
        target_type: row.target_type,
        target_id: row.target_id,
        reason: row.reason,
        note: row.note,
        status: row.status,
        created_at: toIso(row.created_at),
        handled_at: toIso(row.handled_at),
        admin_name: row.admin_name,
        // null, wenn das meldende Konto inzwischen geloescht wurde.
        reporter: row.reporter_name
          ? { name: row.reporter_name, username: row.reporter_username }
          : null,
        // null, wenn der gemeldete Inhalt weg ist.
        target: targets.get(`${row.target_type}:${row.target_id}`) ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/reports/:id  (nur Admin) – Meldung als bearbeitet oder
// verworfen markieren. Was mit dem Inhalt passiert, entscheidet der Admin mit den
// bestehenden Werkzeugen; hier wird nur die Liste abgearbeitet.
router.patch('/admin/reports/:id', requireAuth, rateLimit('admin'), requireAdmin, async (req, res, next) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['open', 'reviewed', 'dismissed'].includes(status)) {
      throw new HttpError(422, 'Unbekannter Stand.', { status: ['Unbekannter Stand.'] });
    }

    const report = await first('SELECT id FROM content_reports WHERE id = ?', [
      Number(req.params.id) || 0,
    ]);
    if (!report) throw new HttpError(404, 'Diese Meldung gibt es nicht.');

    // Zurueck auf offen heisst auch: wieder ohne Bearbeiter:in und ohne
    // Zeitpunkt. Sonst stuende ein Name an einer Meldung, die niemand bearbeitet
    // hat. Der Zeitpunkt kommt wie ueberall sonst von der Datenbank (NOW()) und
    // nicht aus diesem Prozess – sonst haengt er an der Zeitzone des Servers.
    await pool.query(
      `UPDATE content_reports
          SET status = ?,
              handled_by = ?,
              handled_at = IF(? = 'open', NULL, NOW())
        WHERE id = ?`,
      [status, status === 'open' ? null : req.user.id, status, report.id],
    );

    res.json({ message: 'Meldung aktualisiert.' });
  } catch (err) {
    next(err);
  }
});

export default router;
