/**
 * Storys: kurze Beitraege, die nach 24 Stunden von selbst verschwinden.
 *
 * ## Wer sie machen darf
 *
 * Ab Creator (`hasPublicProfile`, siehe accounts.js) – also Creator, Business und
 * Business Plus. Ein Standard-Konto hat keinen oeffentlichen Auftritt und damit
 * auch keine Story: Es waere die einzige Stelle, an der ein Konto ohne Profil
 * etwas veroeffentlichen koennte, und der Bruch faellt sofort auf.
 *
 * ## Warum die Ablaufzeit in der Spalte steht und nicht gerechnet wird
 *
 * `expires_at` wird beim Anlegen gesetzt. Damit ist die Frist ein Datum und keine
 * Rechnung ueber `created_at` – aendert sich die Laufzeit spaeter, laufen alte
 * Storys nach ihrer alten Frist ab statt ploetzlich rueckwirkend anders. Geloescht
 * wird beim Lesen (unten): Ein Cron-Job waere die saubere Loesung, aber dieser
 * Server hat keinen, und eine Story, die noch in der Tabelle steht aber nicht mehr
 * ausgeliefert wird, tut niemandem weh.
 *
 * ## Vorschlagsreihenfolge
 *
 * Ungesehene zuerst, darin die neuesten. Das ist die Reihenfolge, in der man
 * Storys ueberall kennt – und die einzige, bei der die Leiste nach dem Ansehen
 * nicht wieder bei derselben Story anfaengt.
 */
import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError, Validator } from '../validate.js';
import { abilitiesFor } from '../accounts.js';
import { moderateContent, fieldErrorsFor } from '../moderation.js';
import { mediaUrl, publicBase } from '../media.js';

const router = Router();

const STORY_DIR = path.join(process.cwd(), 'storage', 'stories');
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Wie lange eine Story sichtbar bleibt. */
export const STORY_HOURS = 24;
/** Laenge der Bildunterschrift – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_CAPTION = 200;
/** So viele Storys liefert die Leiste hoechstens aus. */
const STORY_LIMIT = 60;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

/** Multer mit eigener Fehlermeldung – der allgemeine Handler spricht von Bannern. */
function uploadImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(
        new HttpError(422, 'Das Bild darf hoechstens 5 MB gross sein.', {
          image: ['Das Bild darf hoechstens 5 MB gross sein.'],
        }),
      );
    }
    return next(err);
  });
}

/** Verlangt ein Konto, das veroeffentlichen darf. Laeuft NACH requireAuth. */
function requirePublisher(req, res, next) {
  if (!abilitiesFor(req.user).hasPublicProfile) {
    return res.status(403).json({ message: 'Storys gibt es ab der Stufe Creator.' });
  }
  return next();
}

function transformStory(req, row) {
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
     * kennt keine Zeitzone: `TIMESTAMPDIFF` gegen dasselbe `NOW()`, mit dem oben
     * auch gefiltert wird, kann per Konstruktion nicht auseinanderlaufen.
     */
    expires_in_minutes: row.expires_in_minutes === undefined
      ? null
      : Number(row.expires_in_minutes),
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
 * Abgelaufene Storys samt Bild wegraeumen.
 *
 * Laeuft bei jedem Lesen und darf still scheitern: Der Filter im SELECT sorgt
 * ohnehin dafuer, dass nichts Abgelaufenes ausgeliefert wird – das Aufraeumen
 * spart nur Platz.
 */
async function sweepExpired() {
  const [rows] = await pool.query(
    'SELECT id, image_path FROM stories WHERE expires_at <= NOW() LIMIT 200',
  );
  if (rows.length === 0) return;

  await pool.query(
    `DELETE FROM stories WHERE id IN (${rows.map(() => '?').join(', ')})`,
    rows.map((row) => row.id),
  );

  for (const row of rows) {
    if (!row.image_path) continue;
    try {
      fs.unlinkSync(path.join(process.cwd(), 'storage', row.image_path));
    } catch {
      /* Datei evtl. schon weg – das darf das Aufraeumen nicht kippen. */
    }
  }
}

// GET /api/stories  (geschuetzt) – laufende Storys, ungesehene zuerst.
router.get('/stories', requireAuth, async (req, res, next) => {
  try {
    await sweepExpired().catch(() => {});

    const [rows] = await pool.query(
      `SELECT s.id, s.user_id, s.caption, s.image_path, s.created_at, s.expires_at,
              TIMESTAMPDIFF(MINUTE, NOW(), s.expires_at) AS expires_in_minutes,
              u.name, u.username, u.avatar, u.account_type,
              (v.user_id IS NOT NULL) AS seen,
              (s.user_id = ?) AS is_mine
         FROM stories s
         JOIN users u ON u.id = s.user_id
    LEFT JOIN story_views v ON v.story_id = s.id AND v.user_id = ?
        WHERE s.expires_at > NOW()
          AND (u.banned_until IS NULL OR u.banned_until <= NOW())
        ORDER BY seen ASC, s.created_at DESC, s.id DESC
        LIMIT ${STORY_LIMIT}`,
      [req.user.id, req.user.id],
    );

    res.json({
      data: rows.map((row) => transformStory(req, row)),
      /** Damit die App den ＋-Ring nur zeigt, wenn er auch etwas tut. */
      can_publish: abilitiesFor(req.user).hasPublicProfile,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/stories  (geschuetzt, ab Creator; multipart wegen Bild)
router.post('/stories', requireAuth, requirePublisher, uploadImage, async (req, res, next) => {
  try {
    const caption = String(req.body?.caption ?? '').trim();
    const v = new Validator(req.body ?? {});

    // Eine Story ohne Bild waere eine Textkarte – und die gibt es hier schon als
    // Beitrag auf dem Profil. Bild ist also Pflicht, die Unterschrift nicht.
    if (!req.file) v.add('image', 'Waehle ein Bild fuer deine Story.');
    else if (!ALLOWED_MIME.includes(req.file.mimetype)) {
      v.add('image', 'Das Bild muss jpeg, png oder webp sein.');
    }
    if (caption.length > MAX_CAPTION) {
      v.add('caption', `Die Unterschrift fasst hoechstens ${MAX_CAPTION} Zeichen.`);
    }
    v.throwIfFails();

    // KI-Verifizierung VOR dem Speichern – wie bei Events und Beitraegen.
    const check = await moderateContent({
      user: req.user,
      context: 'story',
      description: caption || 'Story ohne Unterschrift',
      image: { buffer: req.file.buffer, mimetype: req.file.mimetype },
    });

    if (!check.allowed) {
      if (check.timedOut) {
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
      throw new HttpError(
        422,
        check.reason ?? 'Dieser Inhalt ist nicht jugendfrei.',
        fieldErrorsFor(check, { beschreibung: 'caption', titel: 'caption', bild: 'image' }),
      );
    }

    fs.mkdirSync(STORY_DIR, { recursive: true });
    const name = `${crypto.randomBytes(20).toString('hex')}.${EXT_BY_MIME[req.file.mimetype]}`;
    fs.writeFileSync(path.join(STORY_DIR, name), req.file.buffer);

    const [result] = await pool.query(
      `INSERT INTO stories (user_id, caption, image_path, created_at, expires_at)
       VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [req.user.id, caption || null, `stories/${name}`, STORY_HOURS],
    );

    const row = await first(
      `SELECT s.id, s.user_id, s.caption, s.image_path, s.created_at, s.expires_at,
              TIMESTAMPDIFF(MINUTE, NOW(), s.expires_at) AS expires_in_minutes,
              u.name, u.username, u.avatar, u.account_type,
              1 AS seen, 1 AS is_mine
         FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      [result.insertId],
    );
    res.status(201).json({ data: transformStory(req, row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/stories/:id/view  (geschuetzt) – als gesehen merken (idempotent).
router.post('/stories/:id/view', requireAuth, async (req, res, next) => {
  try {
    const story = await first('SELECT id FROM stories WHERE id = ? AND expires_at > NOW()', [
      req.params.id,
    ]);
    if (!story) throw new HttpError(404, 'Diese Story gibt es nicht mehr.');

    await pool.query(
      `INSERT INTO story_views (story_id, user_id, created_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [story.id, req.user.id],
    );
    res.json({ message: 'Gesehen.' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stories/:id  (geschuetzt) – eigene Story; Admins jede.
router.delete('/stories/:id', requireAuth, async (req, res, next) => {
  try {
    const story = await first('SELECT id, user_id, image_path FROM stories WHERE id = ?', [
      req.params.id,
    ]);
    if (!story) throw new HttpError(404, 'Diese Story gibt es nicht.');
    if (!req.user.is_admin && story.user_id !== req.user.id) {
      throw new HttpError(403, 'Du kannst nur eigene Storys loeschen.');
    }

    await pool.query('DELETE FROM stories WHERE id = ?', [story.id]);
    if (story.image_path) {
      try {
        fs.unlinkSync(path.join(process.cwd(), 'storage', story.image_path));
      } catch {
        /* siehe sweepExpired */
      }
    }
    res.json({ message: 'Story geloescht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
