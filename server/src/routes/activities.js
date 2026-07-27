import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { pool, first, toIso } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { Validator, HttpError, missingIds } from '../validate.js';

const router = Router();

const BANNER_DIR = path.join(process.cwd(), 'storage', 'banners');
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB, wie Laravel (max:5120 KB)
});

function publicBase(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

/** Baut die Activity-Antwort exakt wie der Laravel-ActivityController::transform. */
function transform(req, activity, host, interests, participants, currentUserId) {
  return {
    id: activity.id,
    title: activity.title,
    description: activity.description,
    location: activity.location,
    starts_at: toIso(activity.starts_at),
    banner_url: activity.banner_path ? `${publicBase(req)}/storage/${activity.banner_path}` : null,
    max_participants: activity.max_participants ?? null,
    host: host ? { id: host.id, name: host.name, username: host.username } : null,
    interests: interests.map((i) => ({ id: i.id, name: i.name, icon: i.icon })),
    participants: participants.map((p) => ({ id: p.id, name: p.name, username: p.username })),
    participants_count: participants.length,
    is_joined: participants.some((p) => p.id === currentUserId),
    // Beitritts-Zeitpunkt der:des aktuellen Nutzer:in (fuer den Verlauf in „Meine
    // Aktivitaeten"). null, wenn nicht beigetreten.
    joined_at: toIso(participants.find((p) => p.id === currentUserId)?.joined_at ?? null),
  };
}

/** Laedt alle Zusatzdaten fuer eine Liste von Activity-IDs (kein N+1). */
async function loadRelations(ids) {
  if (ids.length === 0) {
    return { hosts: new Map(), interests: new Map(), participants: new Map() };
  }
  const ph = ids.map(() => '?').join(',');

  const [acts] = await pool.query(`SELECT id, user_id FROM activities WHERE id IN (${ph})`, ids);
  const hostIds = [...new Set(acts.map((a) => a.user_id))];
  const [hostRows] = hostIds.length
    ? await pool.query(
        `SELECT id, name, username FROM users WHERE id IN (${hostIds.map(() => '?').join(',')})`,
        hostIds,
      )
    : [[]];
  const hostById = new Map(hostRows.map((h) => [h.id, h]));
  const hosts = new Map(acts.map((a) => [a.id, hostById.get(a.user_id) ?? null]));

  const [interestRows] = await pool.query(
    `SELECT ai.activity_id, i.id, i.name, i.slug, i.icon
       FROM activity_interest ai
       JOIN interests i ON i.id = ai.interest_id
      WHERE ai.activity_id IN (${ph})
      ORDER BY i.name`,
    ids,
  );
  const [participantRows] = await pool.query(
    `SELECT au.activity_id, au.created_at AS joined_at, u.id, u.name, u.username
       FROM activity_user au
       JOIN users u ON u.id = au.user_id
      WHERE au.activity_id IN (${ph})`,
    ids,
  );

  const interests = new Map(ids.map((id) => [id, []]));
  interestRows.forEach((r) => interests.get(r.activity_id)?.push(r));
  const participants = new Map(ids.map((id) => [id, []]));
  participantRows.forEach((r) => participants.get(r.activity_id)?.push(r));

  return { hosts, interests, participants };
}

async function respondSingle(req, res, activityId, currentUserId) {
  const activity = await first('SELECT * FROM activities WHERE id = ?', [activityId]);
  if (!activity) {
    throw new HttpError(404, 'Aktivitaet nicht gefunden.');
  }
  const rel = await loadRelations([activity.id]);
  res.json({
    data: transform(
      req,
      activity,
      rel.hosts.get(activity.id),
      rel.interests.get(activity.id) ?? [],
      rel.participants.get(activity.id) ?? [],
      currentUserId,
    ),
  });
}

// GET /api/activities  (geschuetzt)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [activities] = await pool.query('SELECT * FROM activities ORDER BY starts_at');
    const ids = activities.map((a) => a.id);
    const rel = await loadRelations(ids);
    const data = activities.map((a) =>
      transform(req, a, rel.hosts.get(a.id), rel.interests.get(a.id) ?? [], rel.participants.get(a.id) ?? [], req.user.id),
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /api/activities  (geschuetzt, multipart wegen Banner)
router.post('/', requireAuth, upload.single('banner'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const v = new Validator(b);

    if (!b.title || b.title.length > 255) v.add('title', 'Der Titel ist erforderlich (max. 255 Zeichen).');
    if (!b.description || b.description.length > 2000) {
      v.add('description', 'Die Beschreibung ist erforderlich (max. 2000 Zeichen).');
    }
    if (!b.location || b.location.length > 255) v.add('location', 'Der Ort ist erforderlich (max. 255 Zeichen).');

    const startsAt = b.starts_at ? new Date(b.starts_at) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) v.add('starts_at', 'Ungueltiges Datum.');

    // max_participants ist optional; leer/fehlend => unbegrenzt (NULL).
    let maxParticipants = null;
    if (b.max_participants !== undefined && b.max_participants !== null && String(b.max_participants).trim() !== '') {
      const n = Number(b.max_participants);
      if (!Number.isInteger(n) || n < 1 || n > 100000) {
        v.add('max_participants', 'Die maximale Teilnehmerzahl muss eine ganze Zahl ab 1 sein.');
      } else {
        maxParticipants = n;
      }
    }

    // interests[] kommt bei multipart als String oder Array
    let interests = [];
    if (Array.isArray(b.interests)) interests = b.interests.map(Number);
    else if (b.interests !== undefined) interests = [Number(b.interests)];
    if (interests.length > 5) v.add('interests', 'Du kannst hoechstens 5 Interessen auswaehlen.');
    if (interests.length > 0 && (await missingIds('interests', interests)).length > 0) {
      v.add('interests', 'Mindestens ein Interesse existiert nicht.');
    }

    if (req.file && !ALLOWED_MIME.includes(req.file.mimetype)) {
      v.add('banner', 'Das Banner muss ein Bild sein (jpeg, png, webp).');
    }

    v.throwIfFails();

    // Banner speichern
    let bannerPath = null;
    if (req.file) {
      fs.mkdirSync(BANNER_DIR, { recursive: true });
      const ext = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[req.file.mimetype];
      const name = `${crypto.randomBytes(20).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(BANNER_DIR, name), req.file.buffer);
      bannerPath = `banners/${name}`;
    }

    // starts_at als UTC 'YYYY-MM-DD HH:MM:SS'
    const startsAtSql = startsAt.toISOString().slice(0, 19).replace('T', ' ');

    const [result] = await pool.query(
      `INSERT INTO activities (user_id, title, description, location, starts_at, banner_path, max_participants, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [req.user.id, b.title, b.description, b.location, startsAtSql, bannerPath, maxParticipants],
    );

    if (interests.length > 0) {
      const rows = interests.map(() => '(?, ?)').join(', ');
      const params = interests.flatMap((id) => [result.insertId, id]);
      await pool.query(`INSERT INTO activity_interest (activity_id, interest_id) VALUES ${rows}`, params);
    }

    // Der:die Ersteller:in ist automatisch dabei (zaehlt gegen das Teilnehmer-Limit).
    await pool.query(
      `INSERT INTO activity_user (activity_id, user_id, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [result.insertId, req.user.id],
    );

    res.status(201);
    await respondSingle(req, res, result.insertId, req.user.id);
  } catch (err) {
    next(err);
  }
});

// GET /api/activities/:id  (geschuetzt)
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    await respondSingle(req, res, req.params.id, req.user.id);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/activities/:id  (nur Admin) – loescht ein beliebiges Event.
// Die Verknuepfungen (Teilnehmer, Interessen) raeumt die DB per ON DELETE CASCADE.
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const activity = await first('SELECT id, banner_path FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');

    await pool.query('DELETE FROM activities WHERE id = ?', [activity.id]);

    // Banner-Datei aufraeumen (best effort – ein Fehler hier soll das Loeschen nicht kippen).
    if (activity.banner_path) {
      try {
        fs.unlinkSync(path.join(process.cwd(), 'storage', activity.banner_path));
      } catch {
        /* Datei evtl. schon weg – ignorieren. */
      }
    }

    res.json({ message: 'Aktivitaet geloescht.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/activities/:id/join  (geschuetzt, idempotent)
router.post('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const activity = await first('SELECT id, max_participants FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');

    // Kapazitaet pruefen (nur wenn ein Limit gesetzt ist). Bereits beigetretene
    // Nutzer:innen duerfen bleiben – der Beitritt ist idempotent.
    if (activity.max_participants != null) {
      const already = await first(
        'SELECT 1 AS ok FROM activity_user WHERE activity_id = ? AND user_id = ?',
        [activity.id, req.user.id],
      );
      if (!already) {
        const countRow = await first(
          'SELECT COUNT(*) AS c FROM activity_user WHERE activity_id = ?',
          [activity.id],
        );
        if (Number(countRow.c) >= activity.max_participants) {
          throw new HttpError(422, 'Dieses Event ist bereits voll.');
        }
      }
    }

    await pool.query(
      `INSERT INTO activity_user (activity_id, user_id, created_at, updated_at)
       VALUES (?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [activity.id, req.user.id],
    );
    await respondSingle(req, res, activity.id, req.user.id);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/activities/:id/join  (geschuetzt)
router.delete('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const activity = await first('SELECT id FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');
    await pool.query('DELETE FROM activity_user WHERE activity_id = ? AND user_id = ?', [
      activity.id,
      req.user.id,
    ]);
    await respondSingle(req, res, activity.id, req.user.id);
  } catch (err) {
    next(err);
  }
});

export default router;
