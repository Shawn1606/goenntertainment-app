import { createRouter } from '../router.js';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pool, first, toIso } from '../db.js';
import { requireAuth, requireAdmin, PERMANENT_BAN_UNTIL, setBan, recordBanEvidence } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { Validator, HttpError, isAlphaDash } from '../validate.js';
import { rejectBlockedTerms } from '../blocked-terms.js';
import { MSG_RESERVED_USERNAME, isReservedUsername } from '../reserved-accounts.js';
import { REQUESTABLE_ACCOUNT_TYPES } from '../accounts.js';
import { transformRequest } from './upgrades.js';
import { mediaUrl, publicBase } from '../media.js';
import { deleteUserAccount } from '../account-deletion.js';
import { singleUpload } from '../uploads.js';

const router = createRouter();

// Beweis-Bilder (Screenshots) landen unter storage/evidence und werden wie die
// Banner ueber /storage ausgeliefert.
const EVIDENCE_DIR = path.join(process.cwd(), 'storage', 'evidence');
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Evidence image (5 MB, uploads.js) plus the fields `reason` and `minutes`, with some headroom.
const uploadEvidence = singleUpload('evidence', { maxFields: 4 });

/** Speichert ein hochgeladenes Beweis-Bild und gibt den relativen Pfad zurueck (oder null). */
function saveEvidenceImage(file) {
  if (!file) return null;
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    throw new HttpError(422, 'Der Beweis muss ein Bild sein (jpeg, png, webp).');
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const name = `${crypto.randomBytes(20).toString('hex')}.${EXT_BY_MIME[file.mimetype]}`;
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), file.buffer);
  return `evidence/${name}`;
}

// Wie viele Tage der Verlaufs-Graph zurueckreicht.
const SERIES_DAYS = 14;
// Zeitfenster fuer die "zuletzt"-Zahlen (neue Nutzer / Beitritte).
const RECENT_DAYS = 7;

/** 'YYYY-MM-DD' fuer einen Tag relativ zu heute (UTC), offset in Tagen. */
function dayKey(offsetFromToday) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetFromToday);
  return d.toISOString().slice(0, 10);
}

/**
 * Baut eine luecken-freie Tages-Reihe der letzten SERIES_DAYS Tage.
 * `rows` = [{ d: 'YYYY-MM-DD', c: number }]. Fehlende Tage werden mit 0 gefuellt,
 * damit der Graph in der App keine Loecher hat.
 */
function fillSeries(rows) {
  const byDay = new Map(rows.map((r) => [String(r.d), Number(r.c)]));
  const series = [];
  for (let i = SERIES_DAYS - 1; i >= 0; i -= 1) {
    const day = dayKey(-i);
    series.push({ date: day, count: byDay.get(day) ?? 0 });
  }
  return series;
}

// GET /api/admin/stats  (nur Admin)
// Liefert alles fuers Admin-Panel: Kennzahlen + Tages-Verlauf fuer den Graphen.
router.get('/stats', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const since = `${dayKey(-(SERIES_DAYS - 1))} 00:00:00`;

    const [
      [[users]],
      [[activities]],
      [[joins]],
      [[stories]],
      [[pendingRequests]],
      [[openReports]],
      [[recentUsers]],
      [[recentJoins]],
      [signupRows],
      [joinRows],
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS c FROM users'),
      pool.query('SELECT COUNT(*) AS c FROM activities'),
      pool.query('SELECT COUNT(*) AS c FROM activity_user'),
      // Nur LAUFENDE Storys: abgelaufene sind fuer niemanden mehr sichtbar, also
      // auch keine Zahl, an der ein Admin etwas tun koennte.
      pool.query('SELECT COUNT(*) AS c FROM stories WHERE expires_at > NOW()'),
      pool.query(`SELECT COUNT(*) AS c FROM account_upgrade_requests WHERE status = 'pending'`),
      // Offene Meldungen: die zweite Zahl im Panel, an der jemand wartet – hier
      // sogar jemand, der ein Problem gemeldet hat (siehe src/routes/reports.js).
      pool.query(`SELECT COUNT(*) AS c FROM content_reports WHERE status = 'open'`),
      pool.query('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [`${dayKey(-(RECENT_DAYS - 1))} 00:00:00`]),
      pool.query('SELECT COUNT(*) AS c FROM activity_user WHERE created_at >= ?', [`${dayKey(-(RECENT_DAYS - 1))} 00:00:00`]),
      pool.query(
        'SELECT DATE(created_at) AS d, COUNT(*) AS c FROM users WHERE created_at >= ? GROUP BY DATE(created_at)',
        [since],
      ),
      pool.query(
        'SELECT DATE(created_at) AS d, COUNT(*) AS c FROM activity_user WHERE created_at >= ? GROUP BY DATE(created_at)',
        [since],
      ),
    ]);

    res.json({
      totals: {
        users: Number(users.c),
        activities: Number(activities.c),
        joins: Number(joins.c),
        stories: Number(stories.c),
        /** Offene Konto-Anfragen – die Zahl, die im Panel auf Arbeit hinweist. */
        pending_requests: Number(pendingRequests.c),
        /** Offene Meldungen von Nutzer:innen. */
        open_reports: Number(openReports.c),
      },
      recent: {
        days: RECENT_DAYS,
        new_users: Number(recentUsers.c),
        joins: Number(recentJoins.c),
      },
      series: {
        days: SERIES_DAYS,
        signups: fillSeries(signupRows),
        joins: fillSeries(joinRows),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users  (nur Admin) – alle Nutzer mit ein paar Kennzahlen.
// hosted = selbst erstellte Events, joined = beigetretene Events.
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.username, u.email, u.account_type, u.is_admin, u.avatar, u.created_at, u.banned_until, u.ban_reason,
              (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id)   AS hosted_count,
              (SELECT COUNT(*) FROM activity_user au WHERE au.user_id = u.id) AS joined_count
         FROM users u
        ORDER BY u.created_at DESC, u.id DESC`,
    );

    const now = Date.now();
    const data = rows.map((u) => {
      const untilMs = u.banned_until
        ? new Date(`${String(u.banned_until).replace(' ', 'T')}Z`).getTime()
        : 0;
      const banned = untilMs > now;
      // „Bann" = weit in der Zukunft; ein konkreter Zeitpunkt ist ein Timeout.
      const permanent = banned && untilMs > Date.now() + 100 * 365 * 24 * 3600 * 1000;
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        account_type: u.account_type,
        is_admin: Boolean(u.is_admin),
        avatar: mediaUrl(req, u.avatar),
        created_at: toIso(u.created_at),
        hosted_count: Number(u.hosted_count),
        joined_count: Number(u.joined_count),
        banned,
        banned_permanent: permanent,
        banned_until: banned && !permanent ? toIso(u.banned_until) : null,
        ban_reason: banned ? u.ban_reason ?? null : null,
      };
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * Laedt den Ziel-Nutzer einer Admin-Aktion. Schuetzt davor, die Aktion auf das
 * EIGENE Konto anzuwenden (sonst sperrt/loescht sich der Admin selbst aus).
 */
async function loadTargetUser(req) {
  if (Number(req.params.id) === Number(req.user.id)) {
    throw new HttpError(400, 'Diese Aktion kannst du nicht auf dein eigenes Konto anwenden.');
  }
  const user = await first('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) throw new HttpError(404, 'Nutzer nicht gefunden.');
  return user;
}

// PATCH /api/admin/users/:id  (nur Admin) – Benutzername aendern.
router.patch('/users/:id', requireAuth, rateLimit('admin'), requireAdmin, async (req, res, next) => {
  try {
    const user = await loadTargetUser(req);
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const v = new Validator(req.body ?? {});
    if (username.length < 3 || username.length > 30 || !isAlphaDash(username)) {
      v.add('username', 'Der Benutzername ist ungueltig (3-30 Zeichen, nur Buchstaben/Zahlen/-_).');
    } else if (
      username.toLowerCase() !== String(user.username ?? '').toLowerCase() &&
      isReservedUsername(username)
    ) {
      // The system's own names (shared/reserved-accounts.json) are not handed to another account,
      // not even by an admin (F-05); an account that already has one keeps it.
      v.add('username', MSG_RESERVED_USERNAME);
    } else {
      // Auch fuer Admins: Umbenennen ist genau der Weg, auf dem ein anstoessiger
      // Altname verschwinden soll – nicht der, auf dem ein neuer entsteht.
      rejectBlockedTerms(v, 'username', username, 'username');
    }
    if (!v.fails() && (await first('SELECT id FROM users WHERE username = ? AND id <> ?', [username, user.id]))) {
      v.add('username', 'Dieser Benutzername ist bereits vergeben.');
    }
    v.throwIfFails();

    await pool.query('UPDATE users SET username = ?, updated_at = NOW() WHERE id = ?', [username, user.id]);
    res.json({ message: 'Benutzername geaendert.', username });
  } catch (err) {
    next(err);
  }
});

/** Liest einen Pflicht-Grund aus dem Request (3–255 Zeichen), sonst 422. */
function requireReason(req) {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 255) {
    throw new HttpError(422, 'Bitte einen Grund angeben (3–255 Zeichen).', {
      reason: ['Bitte einen Grund angeben (3–255 Zeichen).'],
    });
  }
  return reason;
}

// setBan() und recordBanEvidence() liegen in auth.js – die KI-Moderation
// (server/src/moderation.js) nutzt dieselben Helfer fuer ihre Auto-Sperren.

// POST /api/admin/users/:id/ban  (nur Admin) – dauerhaft sperren.
// multipart: Feld `reason` (Pflicht) + optionales Beweis-Bild `evidence`.
router.post('/users/:id/ban', requireAuth, rateLimit('admin'), requireAdmin, uploadEvidence, async (req, res, next) => {
  try {
    const user = await loadTargetUser(req);
    const reason = requireReason(req);
    const imagePath = saveEvidenceImage(req.file);
    await setBan(user.id, PERMANENT_BAN_UNTIL, reason);
    await recordBanEvidence({ userId: user.id, adminId: req.user.id, action: 'ban', reason, until: null, imagePath });
    res.json({ message: 'Nutzer gebannt.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/timeout  (nur Admin) – zeitlich sperren.
// multipart: Felder `minutes` + `reason` (Pflicht) + optionales Beweis-Bild `evidence`.
router.post('/users/:id/timeout', requireAuth, rateLimit('admin'), requireAdmin, uploadEvidence, async (req, res, next) => {
  try {
    const user = await loadTargetUser(req);
    const reason = requireReason(req);
    const minutes = Number(req.body?.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60 * 24 * 365) {
      throw new HttpError(422, 'Ungueltige Timeout-Dauer (1 Minute bis 1 Jahr).');
    }
    const until = new Date(Date.now() + minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
    const imagePath = saveEvidenceImage(req.file);
    await setBan(user.id, until, reason);
    await recordBanEvidence({ userId: user.id, adminId: req.user.id, action: 'timeout', reason, until, imagePath });
    res.json({ message: 'Timeout gesetzt.', banned_until: `${until.replace(' ', 'T')}Z` });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/unban  (nur Admin) – Sperre/Timeout aufheben (Grund leeren).
router.post('/users/:id/unban', requireAuth, rateLimit('admin'), requireAdmin, async (req, res, next) => {
  try {
    const user = await loadTargetUser(req);
    await pool.query('UPDATE users SET banned_until = NULL, ban_reason = NULL, updated_at = NOW() WHERE id = ?', [
      user.id,
    ]);
    res.json({ message: 'Sperre aufgehoben.' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id  (nur Admin) – Konto endgueltig loeschen.
// Verknuepfte Daten raeumt die DB per Cascade; Tokens und hochgeladene Dateien
// raeumt deleteUserAccount (src/account-deletion.js) – derselbe Ablauf wie beim
// Selbst-Loeschen ueber DELETE /api/me. Der letzte Admin ist hier nicht zu
// schuetzen: Wer loescht, ist selbst Admin und bleibt (loadTargetUser verbietet
// das eigene Konto).
router.delete('/users/:id', requireAuth, rateLimit('admin'), requireAdmin, async (req, res, next) => {
  try {
    const user = await loadTargetUser(req);
    await deleteUserAccount(user.id);
    res.json({ message: 'Nutzer geloescht.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/evidence  (nur Admin) – alle Beweismittel, neueste zuerst.
router.get('/evidence', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.action, e.reason, e.banned_until, e.image_path, e.created_at, e.source,
              u.id AS user_id, u.name AS user_name, u.username AS user_username,
              a.name AS admin_name
         FROM ban_evidence e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN users a ON a.id = e.admin_id
        ORDER BY e.created_at DESC, e.id DESC`,
    );

    const data = rows.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      banned_until: toIso(r.banned_until),
      image_url: r.image_path ? `${publicBase(req)}/storage/${r.image_path}` : null,
      created_at: toIso(r.created_at),
      user: { id: r.user_id, name: r.user_name, username: r.user_username },
      admin_name: r.admin_name ?? null,
      // 'ai' = automatisch von der KI-Moderation gesetzt (kein Admin beteiligt).
      source: r.source === 'ai' ? 'ai' : 'admin',
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/moderation  (nur Admin) – Berichte der KI-Verifizierung.
// Neueste zuerst; `?only=flagged` zeigt nur alles ab Schwere 1 (spart Scrollen).
router.get('/moderation', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const onlyFlagged = req.query.only === 'flagged';
    const [rows] = await pool.query(
      `SELECT m.id, m.context, m.verdict, m.severity, m.categories, m.fields, m.reason, m.action,
              m.title, m.body, m.interests, m.image_path, m.model, m.latency_ms, m.created_at,
              u.id AS user_id, u.name AS user_name, u.username AS user_username
         FROM moderation_reports m
         LEFT JOIN users u ON u.id = m.user_id
        ${onlyFlagged ? 'WHERE m.severity > 0' : ''}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 200`,
    );

    const [[counts]] = await pool.query(
      // blocked = alle abgelehnten Inhalte (mit und ohne Sperre),
      // timeouts = die Teilmenge, die zusaetzlich eine Sperre ausgeloest hat.
      `SELECT COUNT(*) AS total,
              SUM(action <> 'none')   AS blocked,
              SUM(action = 'timeout') AS timeouts,
              SUM(verdict = 'error')  AS errors
         FROM moderation_reports`,
    );

    const split = (value) => (value ? String(value).split(',').filter(Boolean) : []);

    res.json({
      totals: {
        checked: Number(counts.total ?? 0),
        blocked: Number(counts.blocked ?? 0),
        timeouts: Number(counts.timeouts ?? 0),
        errors: Number(counts.errors ?? 0),
      },
      data: rows.map((r) => ({
        id: r.id,
        context: r.context,
        verdict: r.verdict,
        severity: Number(r.severity),
        categories: split(r.categories),
        fields: split(r.fields),
        reason: r.reason ?? null,
        action: r.action,
        title: r.title ?? null,
        body: r.body ?? null,
        interests: r.interests ?? null,
        image_url: r.image_path ? `${publicBase(req)}/storage/${r.image_path}` : null,
        model: r.model ?? null,
        latency_ms: r.latency_ms ?? null,
        created_at: toIso(r.created_at),
        user: r.user_id ? { id: r.user_id, name: r.user_name, username: r.user_username } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/stories  (nur Admin) – alle LAUFENDEN Storys, neueste zuerst.
//
// Zwei Unterschiede zur Leiste in der App (GET /api/stories):
//   - Storys gesperrter Konten stehen hier mit drin. Genau die will man sehen:
//     Eine Sperre nimmt das Bild nicht aus der Datenbank.
//   - Abgelaufene stehen NICHT drin. Sie sind fuer niemanden mehr sichtbar; sie
//     hier zum Loeschen anzubieten waere Arbeit ohne Wirkung.
// Geloescht wird ueber DELETE /api/stories/:id – dort darf ein Admin ohnehin
// jede Story loeschen, samt Bilddatei (siehe routes/stories.js).
router.get('/stories', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.caption, s.image_path, s.created_at, s.expires_at,
              TIMESTAMPDIFF(MINUTE, NOW(), s.expires_at) AS expires_in_minutes,
              (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id) AS views,
              u.id AS user_id, u.name AS user_name, u.username AS user_username,
              u.account_type AS user_account_type,
              (u.banned_until IS NOT NULL AND u.banned_until > NOW()) AS user_banned
         FROM stories s
         JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > NOW()
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT 200`,
    );

    res.json({
      data: rows.map((r) => ({
        id: r.id,
        caption: r.caption ?? null,
        image_url: r.image_path ? `${publicBase(req)}/storage/${r.image_path}` : null,
        created_at: toIso(r.created_at),
        expires_at: toIso(r.expires_at),
        // Restzeit rechnet die Datenbank – die Zeitstempel tragen ein 'Z', sind
        // aber nicht durchgaengig UTC (Begruendung in routes/stories.js).
        expires_in_minutes: Number(r.expires_in_minutes),
        views: Number(r.views),
        user: {
          id: r.user_id,
          name: r.user_name,
          username: r.user_username,
          account_type: r.user_account_type,
          banned: Boolean(r.user_banned),
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/upgrade-requests  (nur Admin) – Anfragen auf eine hoehere
// Kontostufe. Offene zuerst, darin die aeltesten oben: Wer am laengsten wartet,
// steht ganz vorne. Entschiedene bleiben darunter stehen, damit man nachsehen
// kann, was man selbst gestern entschieden hat.
router.get('/upgrade-requests', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*,
              u.name AS user_name, u.username AS user_username, u.email AS user_email,
              u.account_type AS user_account_type, u.avatar AS user_avatar,
              u.created_at AS user_created_at,
              a.name AS admin_name
         FROM account_upgrade_requests r
         JOIN users u ON u.id = r.user_id
    LEFT JOIN users a ON a.id = r.decided_by
        ORDER BY (r.status = 'pending') DESC,
                 CASE WHEN r.status = 'pending' THEN r.created_at END ASC,
                 r.decided_at DESC, r.id DESC
        LIMIT 100`,
    );

    res.json({
      pending: rows.filter((r) => r.status === 'pending').length,
      data: rows.map((r) => ({
        ...transformRequest(r),
        user: {
          id: r.user_id,
          name: r.user_name,
          username: r.user_username,
          email: r.user_email,
          account_type: r.user_account_type,
          avatar: mediaUrl(req, r.user_avatar),
          /** Seit wann das Konto besteht – bei einer frischen Anfrage die
              wichtigste Zahl zum Einordnen. */
          member_since: toIso(r.user_created_at),
        },
        admin_name: r.admin_name ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Laedt eine OFFENE Anfrage. Eine schon entschiedene zweimal zu entscheiden
 * waere kein Fehler des Admins, sondern ein doppelter Tipp – deshalb 422 mit
 * klarem Satz statt stiller Wiederholung.
 */
async function loadPendingRequest(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Anfrage nicht gefunden.');
  const row = await first('SELECT * FROM account_upgrade_requests WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Anfrage nicht gefunden.');
  if (row.status !== 'pending') {
    throw new HttpError(422, 'Diese Anfrage ist schon entschieden.');
  }
  if (!REQUESTABLE_ACCOUNT_TYPES.includes(row.requested_type)) {
    // Kann nur passieren, wenn eine Stufe nachtraeglich verschwindet. Dann ist
    // die Anfrage nicht mehr erfuellbar – und wir raten nicht, was gemeint war.
    throw new HttpError(422, 'Diese Anfrage nennt eine Kontostufe, die es nicht mehr gibt.');
  }
  return row;
}

// POST /api/admin/upgrade-requests/:id/approve  (nur Admin) – Stufe freischalten.
router.post('/upgrade-requests/:id/approve', requireAuth, rateLimit('admin'), requireAdmin, async (req, res, next) => {
  try {
    const request = await loadPendingRequest(req);

    await pool.query('UPDATE users SET account_type = ?, updated_at = NOW() WHERE id = ?', [
      request.requested_type,
      request.user_id,
    ]);
    await pool.query(
      `UPDATE account_upgrade_requests
          SET status = 'approved', decided_by = ?, decided_at = NOW(),
              decision_note = NULL, updated_at = NOW()
        WHERE id = ?`,
      [req.user.id, request.id],
    );

    res.json({ message: 'Kontostufe bestaetigt.', account_type: request.requested_type });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/upgrade-requests/:id/reject  (nur Admin) – Anfrage ablehnen.
// Body: { reason? } – freiwillig, wird der Person unter ihrer Anfrage gezeigt.
router.post('/upgrade-requests/:id/reject', requireAuth, rateLimit('admin'), requireAdmin, async (req, res, next) => {
  try {
    const request = await loadPendingRequest(req);
    const note = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 255) : '';

    await pool.query(
      `UPDATE account_upgrade_requests
          SET status = 'rejected', decided_by = ?, decided_at = NOW(),
              decision_note = ?, updated_at = NOW()
        WHERE id = ?`,
      [req.user.id, note || null, request.id],
    );

    res.json({ message: 'Anfrage abgelehnt.' });
  } catch (err) {
    next(err);
  }
});

export default router;
