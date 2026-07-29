import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { Validator, HttpError, missingIds } from '../validate.js';
import { moderateActivity, fieldErrorsFor, interestNames } from '../moderation.js';
import { abilitiesFor } from '../accounts.js';
import { awardActivityPoints } from '../rewards.js';
import { publicBase } from '../media.js';

const router = Router();

const BANNER_DIR = path.join(process.cwd(), 'storage', 'banners');
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB, wie Laravel (max:5120 KB)
});

/**
 * Baut die Activity-Antwort exakt wie der Laravel-ActivityController::transform.
 *
 * `saved` kommt als letzter Parameter dazu (statt in `activity` mitzureisen), weil
 * es keine Eigenschaft des Events ist, sondern eine Aussage ueber die:den
 * Aufrufende:n – wie `is_joined`. Voreinstellung `false`: Aufrufer, die die
 * Merkliste nicht mitgeladen haben, behaupten damit nichts Falsches.
 */
function transform(
  req,
  activity,
  host,
  interests,
  participants,
  currentUserId,
  viewsCount = 0,
  saved = false,
) {
  return {
    id: activity.id,
    title: activity.title,
    description: activity.description,
    location: activity.location,
    starts_at: toIso(activity.starts_at),
    banner_url: activity.banner_path ? `${publicBase(req)}/storage/${activity.banner_path}` : null,
    max_participants: activity.max_participants ?? null,
    // Wie viele verschiedene Leute das Event angeschaut haben (ohne den Host).
    views_count: viewsCount,
    // account_type kommt mit, damit die App weiss, ob sich der Name zum Profil
    // verlinken laesst: Ein Standard-Konto hat keine oeffentliche Seite.
    host: host
      ? { id: host.id, name: host.name, username: host.username, account_type: host.account_type }
      : null,
    interests: interests.map((i) => ({ id: i.id, name: i.name, icon: i.icon })),
    participants: participants.map((p) => ({ id: p.id, name: p.name, username: p.username })),
    participants_count: participants.length,
    is_joined: participants.some((p) => p.id === currentUserId),
    // Beitritts-Zeitpunkt der:des aktuellen Nutzer:in (fuer den Verlauf in „Meine
    // Aktivitaeten"). null, wenn nicht beigetreten.
    joined_at: toIso(participants.find((p) => p.id === currentUserId)?.joined_at ?? null),
    // Bis wann das Event hervorgehoben ist (Business-Stufen, siehe routes/business.js).
    // Kommt fuer ALLE mit: Die Empfehlungen der App sortieren danach, nicht nur
    // der Business-Bereich. null = nicht hervorgehoben.
    boosted_until: toIso(activity.boosted_until ?? null),
    // Merkliste: „ich schau mir das noch an". Bewusst getrennt von `is_joined` –
    // Merken ist keine Zusage und belegt keinen Platz (siehe schema.sql).
    is_saved: saved,
  };
}

/**
 * Laedt alle Zusatzdaten fuer eine Liste von Activity-IDs (kein N+1).
 *
 * `userId` ist optional und nur fuer die Merkliste da: Ohne ihn kommt ein leeres
 * `saved` zurueck, und `is_saved` ist dann fuer alle false. So bleiben Aufrufer
 * gueltig, die keine Nutzer:in im Blick haben.
 */
async function loadRelations(ids, userId = null) {
  if (ids.length === 0) {
    return {
      hosts: new Map(),
      interests: new Map(),
      participants: new Map(),
      views: new Map(),
      saved: new Set(),
    };
  }
  const ph = ids.map(() => '?').join(',');

  const [acts] = await pool.query(`SELECT id, user_id FROM activities WHERE id IN (${ph})`, ids);
  const hostIds = [...new Set(acts.map((a) => a.user_id))];
  const [hostRows] = hostIds.length
    ? await pool.query(
        `SELECT id, name, username, account_type FROM users WHERE id IN (${hostIds.map(() => '?').join(',')})`,
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

  const [viewRows] = await pool.query(
    `SELECT activity_id, COUNT(*) AS c FROM activity_views
      WHERE activity_id IN (${ph}) GROUP BY activity_id`,
    ids,
  );

  const [savedRows] = userId
    ? await pool.query(
        `SELECT activity_id FROM activity_saves WHERE user_id = ? AND activity_id IN (${ph})`,
        [userId, ...ids],
      )
    : [[]];

  const interests = new Map(ids.map((id) => [id, []]));
  interestRows.forEach((r) => interests.get(r.activity_id)?.push(r));
  const participants = new Map(ids.map((id) => [id, []]));
  participantRows.forEach((r) => participants.get(r.activity_id)?.push(r));
  const views = new Map(viewRows.map((r) => [r.activity_id, Number(r.c)]));
  const saved = new Set(savedRows.map((r) => r.activity_id));

  return { hosts, interests, participants, views, saved };
}

async function respondSingle(req, res, activityId, currentUserId) {
  const activity = await first('SELECT * FROM activities WHERE id = ?', [activityId]);
  if (!activity) {
    throw new HttpError(404, 'Aktivitaet nicht gefunden.');
  }
  const rel = await loadRelations([activity.id], currentUserId);
  res.json({
    data: transform(
      req,
      activity,
      rel.hosts.get(activity.id),
      rel.interests.get(activity.id) ?? [],
      rel.participants.get(activity.id) ?? [],
      currentUserId,
      rel.views.get(activity.id) ?? 0,
      rel.saved.has(activity.id),
    ),
  });
}

/**
 * Schreibt bzw. reaktiviert einen Verlaufs-Eintrag (beim Erstellen/Beitreten).
 * Speichert einen Schnappschuss, damit der Eintrag auch nach dem Loeschen des
 * Events bestehen bleibt. `removed_at` wird auf NULL gesetzt (= wieder aktiv).
 * Eine bestehende Host-Rolle wird nie zu 'participant' herabgestuft.
 */
async function recordHistory(userId, activity, role) {
  await pool.query(
    `INSERT INTO activity_history
       (user_id, activity_id, role, title, location, starts_at, banner_path, removed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       role = IF(role = 'host', 'host', VALUES(role)),
       title = VALUES(title),
       location = VALUES(location),
       starts_at = VALUES(starts_at),
       banner_path = VALUES(banner_path),
       removed_at = NULL,
       updated_at = NOW()`,
    [
      userId,
      activity.id,
      role,
      activity.title,
      activity.location,
      activity.starts_at ?? null,
      activity.banner_path ?? null,
    ],
  );
}

/** Startet die 7-Tage-Frist fuer Verlaufs-Eintraege (Event geloescht / ausgetreten). */
async function markHistoryRemoved(where, params) {
  await pool.query(
    `UPDATE activity_history SET removed_at = NOW(), updated_at = NOW()
       WHERE ${where} AND removed_at IS NULL`,
    params,
  );
}

/**
 * Loescht Verlaufs-Eintraege, deren 7-Tage-Frist abgelaufen ist, und raeumt
 * dabei Banner-Dateien auf, die danach von niemandem mehr referenziert werden
 * (weder von einer Activity noch von einem verbleibenden Verlaufs-Eintrag).
 */
export async function pruneHistory() {
  const [expiring] = await pool.query(
    `SELECT DISTINCT banner_path FROM activity_history
       WHERE banner_path IS NOT NULL
         AND removed_at IS NOT NULL AND removed_at < (NOW() - INTERVAL 7 DAY)`,
  );

  await pool.query(
    `DELETE FROM activity_history
       WHERE removed_at IS NOT NULL AND removed_at < (NOW() - INTERVAL 7 DAY)`,
  );

  for (const { banner_path } of expiring) {
    if (!banner_path) continue;
    const inActivities = await first('SELECT 1 AS ok FROM activities WHERE banner_path = ? LIMIT 1', [banner_path]);
    const inHistory = await first('SELECT 1 AS ok FROM activity_history WHERE banner_path = ? LIMIT 1', [banner_path]);
    if (!inActivities && !inHistory) {
      try {
        fs.unlinkSync(path.join(process.cwd(), 'storage', banner_path));
      } catch {
        /* Datei evtl. schon weg – ignorieren. */
      }
    }
  }
}

// GET /api/activities  (geschuetzt)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [activities] = await pool.query('SELECT * FROM activities ORDER BY starts_at');
    const ids = activities.map((a) => a.id);
    const rel = await loadRelations(ids, req.user.id);
    const data = activities.map((a) =>
      transform(
        req,
        a,
        rel.hosts.get(a.id),
        rel.interests.get(a.id) ?? [],
        rel.participants.get(a.id) ?? [],
        req.user.id,
        rel.views.get(a.id) ?? 0,
        rel.saved.has(a.id),
      ),
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/activities/history  (geschuetzt) – persoenlicher Verlauf.
// MUSS vor '/:id' stehen, sonst faengt die :id-Route "history" ab.
// Aktive Eintraege (Event existiert, du bist dabei) bleiben dauerhaft; nach dem
// Loeschen/Verlassen laeuft eine 7-Tage-Frist. Aufbau: neueste zuerst, aktive oben.
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    await pruneHistory();
    const [rows] = await pool.query(
      `SELECT id, activity_id, role, title, location, starts_at, banner_path, removed_at, created_at
         FROM activity_history
        WHERE user_id = ?
        ORDER BY (removed_at IS NULL) DESC, COALESCE(removed_at, created_at) DESC, id DESC`,
      [req.user.id],
    );
    const data = rows.map((r) => ({
      id: r.id,
      activity_id: r.activity_id ?? null,
      role: r.role,
      title: r.title,
      location: r.location,
      starts_at: toIso(r.starts_at),
      banner_url: r.banner_path ? `${publicBase(req)}/storage/${r.banner_path}` : null,
      // aktiv = Event existiert noch und du bist dabei (removed_at IS NULL).
      is_active: r.removed_at === null,
      removed_at: toIso(r.removed_at),
      joined_at: toIso(r.created_at),
    }));
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// GET /api/activities/saved  (geschuetzt) – die Merkliste.
//
// MUSS wie '/history' vor '/:id' stehen, sonst faengt die :id-Route "saved" ab.
// Aufbau: was zuletzt gemerkt wurde, steht oben – das ist die Reihenfolge, in der
// man die Liste abarbeitet.
router.get('/saved', requireAuth, async (req, res, next) => {
  try {
    const [activities] = await pool.query(
      `SELECT a.* FROM activities a
         JOIN activity_saves s ON s.activity_id = a.id AND s.user_id = ?
        ORDER BY s.created_at DESC, a.id DESC`,
      [req.user.id],
    );
    const ids = activities.map((a) => a.id);
    const rel = await loadRelations(ids, req.user.id);
    res.json({
      data: activities.map((a) =>
        transform(
          req,
          a,
          rel.hosts.get(a.id),
          rel.interests.get(a.id) ?? [],
          rel.participants.get(a.id) ?? [],
          req.user.id,
          rel.views.get(a.id) ?? 0,
          true,
        ),
      ),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/activities  (geschuetzt, multipart wegen Banner)
router.post('/', requireAuth, upload.single('banner'), async (req, res, next) => {
  try {
    // Events erstellen gibt es erst ab Creator. Die App blendet den ＋-Knopf
    // bei Standard-Konten aus – hier steht der Riegel, der auch dann haelt,
    // wenn jemand die Schnittstelle direkt anspricht.
    if (!abilitiesFor(req.user).canCreateActivities) {
      throw new HttpError(
        403,
        'Zum Erstellen von Events brauchst du ein Creator-Konto. Du kannst in der App upgraden.',
      );
    }

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

    // Selbst eingetippte Interessen: gehen NICHT in die DB, werden aber
    // mitgeprueft – sie sind freier Text und damit der eigentliche Risiko-Teil.
    let customInterests = [];
    if (Array.isArray(b.custom_interests)) customInterests = b.custom_interests;
    else if (b.custom_interests !== undefined) customInterests = [b.custom_interests];
    customInterests = customInterests
      .map((name) => String(name).trim())
      .filter(Boolean)
      .slice(0, 5);

    if (req.file && !ALLOWED_MIME.includes(req.file.mimetype)) {
      v.add('banner', 'Das Banner muss ein Bild sein (jpeg, png, webp).');
    }

    v.throwIfFails();

    // KI-Verifizierung (Jugendschutz) VOR dem Speichern: nicht jugendfreie
    // Inhalte kommen so gar nicht erst in die DB bzw. auf die Platte. Ab der
    // konfigurierten Schwere sperrt die Moderation das Konto automatisch.
    const check = await moderateActivity({
      user: req.user,
      title: b.title,
      description: b.description,
      interests: [...(await interestNames(interests)), ...customInterests],
      image: req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : null,
    });

    if (!check.allowed) {
      if (check.timedOut) {
        // Konto ist ab jetzt gesperrt und der Token entwertet -> gleiche Form
        // wie beim Login-Bann, damit die App den Hinweis anzeigen und abmelden kann.
        return res.status(403).json({
          message: 'Dein Konto wurde automatisch gesperrt: Der Inhalt war nicht jugendfrei.',
          ban: { reason: check.banReason, permanent: false, banned_until: check.bannedUntil },
          moderation: {
            severity: check.severity,
            categories: check.categories,
            fields: check.fields,
            reason: check.reason,
          },
        });
      }
      throw new HttpError(422, check.reason ?? 'Dieser Inhalt ist nicht jugendfrei.', fieldErrorsFor(check));
    }

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

    // Verlauf: erstelltes Event als 'host' eintragen (mit Schnappschuss).
    await recordHistory(
      req.user.id,
      { id: result.insertId, title: b.title, location: b.location, starts_at: startsAtSql, banner_path: bannerPath },
      'host',
    );

    // Praemien-Punkte gutschreiben. Bewusst mit `catch`: Ein Event ist an dieser
    // Stelle schon angelegt: Wuerde die Buchung den Aufruf kippen, saehe die
    // Nutzer:in einen Fehler fuer etwas, das geklappt hat. Fehlende Punkte holt
    // der Nachtrag beim naechsten Blick auf die Praemien nach (src/rewards.js).
    await awardActivityPoints(req.user.id, result.insertId).catch((err) =>
      console.error('[rewards] Punkte konnten nicht gebucht werden:', err),
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

// DELETE /api/activities/:id  – loescht ein Event.
// Erlaubt fuer Admins (jedes Event) ODER die:den Ersteller:in (nur das eigene).
// Die Verknuepfungen (Teilnehmer, Interessen) raeumt die DB per ON DELETE CASCADE.
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const activity = await first('SELECT id, user_id, banner_path FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');

    // Autorisierung: Admin darf alles, sonst nur die:der Ersteller:in.
    if (!req.user.is_admin && activity.user_id !== req.user.id) {
      throw new HttpError(403, 'Du darfst nur eigene Aktivitaeten loeschen.');
    }

    // Verlauf: fuer ALLE Nutzer:innen die 7-Tage-Frist starten, BEVOR das Event
    // weg ist. Der FK (ON DELETE SET NULL) loest danach nur die activity_id –
    // der Schnappschuss (Titel/Ort/Datum/Banner) bleibt erhalten.
    await markHistoryRemoved('activity_id = ?', [activity.id]);

    await pool.query('DELETE FROM activities WHERE id = ?', [activity.id]);

    // Banner-Datei nur aufraeumen, wenn KEIN Verlaufs-Eintrag sie mehr braucht.
    // Neue Events haben immer einen Verlaufs-Eintrag (Host) -> Banner bleibt bis
    // zum Ablauf der 7-Tage-Frist (pruneHistory raeumt es dann auf). Legacy-Events
    // ohne Verlauf werden sofort bereinigt. Best effort – Fehler kippt das Loeschen nicht.
    if (activity.banner_path) {
      const inHistory = await first(
        'SELECT 1 AS ok FROM activity_history WHERE banner_path = ? LIMIT 1',
        [activity.banner_path],
      );
      if (!inHistory) {
        try {
          fs.unlinkSync(path.join(process.cwd(), 'storage', activity.banner_path));
        } catch {
          /* Datei evtl. schon weg – ignorieren. */
        }
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
    const activity = await first(
      'SELECT id, max_participants, title, location, starts_at, banner_path FROM activities WHERE id = ?',
      [req.params.id],
    );
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
    // Verlauf: Beitritt eintragen/reaktivieren (Host-Rolle bleibt erhalten).
    await recordHistory(req.user.id, activity, 'participant');
    await respondSingle(req, res, activity.id, req.user.id);
  } catch (err) {
    next(err);
  }
});

// POST /api/activities/:id/view  (geschuetzt, idempotent)
// Zaehlt einen Aufruf des Detail-Popups. Pro Person genau einmal – so ist die
// Zahl "wie viele Leute haben es gesehen" und nicht "wie oft wurde geklickt".
// Aufrufe der:des Erstellenden zaehlen nicht mit.
router.post('/:id/view', requireAuth, async (req, res, next) => {
  try {
    const activity = await first('SELECT id, user_id FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');

    if (activity.user_id !== req.user.id) {
      await pool.query(
        `INSERT INTO activity_views (activity_id, user_id, created_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE created_at = created_at`,
        [activity.id, req.user.id],
      );
    }

    const row = await first('SELECT COUNT(*) AS c FROM activity_views WHERE activity_id = ?', [activity.id]);
    res.json({ views_count: Number(row?.c ?? 0) });
  } catch (err) {
    next(err);
  }
});

// POST /api/activities/:id/save  (geschuetzt, idempotent) – merken.
//
// Bewusst OHNE Kapazitaets-Pruefung: Merken belegt keinen Platz. Man darf auch ein
// volles Event merken – vielleicht wird ein Platz frei.
router.post('/:id/save', requireAuth, async (req, res, next) => {
  try {
    const activity = await first('SELECT id FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');

    await pool.query(
      `INSERT INTO activity_saves (activity_id, user_id, created_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [activity.id, req.user.id],
    );
    await respondSingle(req, res, activity.id, req.user.id);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/activities/:id/save  (geschuetzt) – nicht mehr merken.
router.delete('/:id/save', requireAuth, async (req, res, next) => {
  try {
    const activity = await first('SELECT id FROM activities WHERE id = ?', [req.params.id]);
    if (!activity) throw new HttpError(404, 'Aktivitaet nicht gefunden.');

    await pool.query('DELETE FROM activity_saves WHERE activity_id = ? AND user_id = ?', [
      activity.id,
      req.user.id,
    ]);
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
    // Verlauf: 7-Tage-Frist starten (Eintrag bleibt bis dahin als „verlassen").
    await markHistoryRemoved('user_id = ? AND activity_id = ?', [req.user.id, activity.id]);
    await respondSingle(req, res, activity.id, req.user.id);
  } catch (err) {
    next(err);
  }
});

export default router;
