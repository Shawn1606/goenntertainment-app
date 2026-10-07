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
import { createRouter } from '../router.js';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pool, first } from '../db.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError, Validator } from '../validate.js';
import { rejectBlockedTerms } from '../blocked-terms.js';
import { abilitiesFor } from '../accounts.js';
import { moderateContent, fieldErrorsFor } from '../moderation.js';
import { notifyFollowers } from '../notifications.js';
import { loadUser } from '../people.js';
import { singleUpload } from '../uploads.js';
// Spalten, Umwandlung und Filter wohnen in `../stories.js`: Profilseite und
// Personenlisten fragen dasselbe, und vier Abschriften derselben Abfrage sind
// vier Wahrheiten darueber, was „laufende Story" heisst (siehe dort).
import {
  STORY_HOURS,
  STORY_LIMIT,
  STORY_LIVE,
  STORY_QUERY,
  storiesOf,
  transformStory,
} from '../stories.js';

const router = createRouter();

const STORY_DIR = path.join(process.cwd(), 'storage', 'stories');
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Laenge der Bildunterschrift – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_CAPTION = 200;

/** Image in the field `image` (5 MB with its own message, uploads.js) plus the caption, with some headroom. */
const uploadImage = singleUpload('image', { maxFields: 3 });

/** Verlangt ein Konto, das veroeffentlichen darf. Laeuft NACH requireAuth. */
function requirePublisher(req, res, next) {
  if (!abilitiesFor(req.user).hasPublicProfile) {
    return res.status(403).json({ message: 'Storys gibt es ab der Stufe Creator.' });
  }
  return next();
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
      `${STORY_QUERY}
        WHERE ${STORY_LIVE}
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

/**
 * GET /api/users/:id/stories  (geschuetzt) – die laufenden Storys EINER Person.
 *
 * Gibt es, seit der Ring um ein Profilbild ueberall antippbar ist: In einer
 * Personenliste (Freunde, Suchtreffer) soll der Betrachter direkt aufgehen und
 * nicht erst das Profil dazwischenschieben. Die Liste kennt nur die ANZAHL der
 * Storys (dafuer reicht `storyMetaFor`) – die Bilder holt dieser Aufruf beim
 * Antippen nach.
 *
 * Nach ID und nicht nach Benutzername: Den hat nicht jedes Konto, die ID immer.
 *
 * Eine leere Liste ist kein Fehler: Zwischen dem Laden der Liste und dem Tipp
 * koennen 24 Stunden liegen. Die App faellt dann aufs Profil zurueck, statt einen
 * schwarzen Betrachter zu zeigen.
 */
router.get('/users/:id/stories', requireAuth, async (req, res, next) => {
  try {
    // Ueber `loadUser`, damit ein unbekanntes Konto denselben 404 gibt wie
    // ueberall sonst – und nicht eine leere Liste, die „keine Storys" behauptet.
    const owner = await loadUser(req.params.id);
    res.json({ data: await storiesOf(req, owner.id, req.user.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/stories  (geschuetzt, ab Creator; multipart wegen Bild)
router.post('/stories', requireAuth, rateLimit('moderated'), requirePublisher, uploadImage, async (req, res, next) => {
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
    } else {
      // Feste Liste vor der KI – sie greift auch ohne Schluessel und bei Ausfall.
      rejectBlockedTerms(v, 'caption', caption, 'text');
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

    // Follower informieren – laeuft nach dem Speichern und schluckt seine Fehler
    // (siehe notifications.js): Die Story steht, egal ob der Verteiler klappt.
    await notifyFollowers(req.user, {
      type: 'story',
      refId: result.insertId,
      // Umlaute: Das ist ANZEIGETEXT, kein Kommentar. Der Rest dieser Datei
      // schreibt bewusst ASCII, hier stuende sonst „veroeffentlicht" mitten in
      // der Benachrichtigung (derselbe Fehler wie frueher bei den Coupon-Titeln).
      title: `${req.user.name} hat eine Story veröffentlicht`,
      body: caption || null,
    });

    res.status(201).json({ data: transformStory(req, row) });
  } catch (err) {
    next(err);
  }
});

// POST /api/stories/:id/view  (geschuetzt) – als gesehen merken (idempotent).
router.post('/stories/:id/view', requireAuth, rateLimit('state'), async (req, res, next) => {
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
router.delete('/stories/:id', requireAuth, rateLimit('content'), async (req, res, next) => {
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
