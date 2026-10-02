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
 * Storys nach ihrer alten Frist ab statt ploetzlich rueckwirkend anders.
 *
 * Expired stories end exactly at expires_at: the image lies in private storage and is served
 * only through GET /api/media/stories/:file, which checks the expiry (and blocks) on every request
 * (F-11). Rows and files are removed hourly and on every read of the bar (sweepExpiredStories in
 * ../stories.js); that only frees the space.
 *
 * ## Vorschlagsreihenfolge
 *
 * Ungesehene zuerst, darin die neuesten. Das ist die Reihenfolge, in der man
 * Storys ueberall kennt – und die einzige, bei der die Leiste nach dem Ansehen
 * nicht wieder bei derselben Story anfaengt.
 */
import { createRouter } from '../router.js';
import { pool, first } from '../db.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError, Validator } from '../validate.js';
import { rejectBlockedTerms } from '../blocked-terms.js';
import { abilitiesFor } from '../accounts.js';
import { moderateContent, fieldErrorsFor } from '../moderation.js';
import { notifyFollowers } from '../notifications.js';
import { hiddenByBlock, loadUser, notBlockedWith } from '../people.js';
import { singleUpload } from '../uploads.js';
import { ALLOWED_MIME, processImageOr422 } from '../images.js';
import { removeStored, sendPrivateFile, STORED_NAME, storeImage } from '../storage.js';
// Spalten, Umwandlung und Filter wohnen in `../stories.js`: Profilseite und
// Personenlisten fragen dasselbe, und vier Abschriften derselben Abfrage sind
// vier Wahrheiten darueber, was „laufende Story" heisst (siehe dort).
import {
  STORY_HOURS,
  STORY_LIMIT,
  STORY_LIVE,
  STORY_QUERY,
  storiesOf,
  storyImageVisible,
  sweepExpiredStories,
  transformStory,
} from '../stories.js';

const router = createRouter();

const MSG_IMAGE_TYPE = 'Das Bild muss jpeg, png oder webp sein.';

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

// GET /api/stories  (geschuetzt) – laufende Storys, ungesehene zuerst.
router.get('/stories', requireAuth, async (req, res, next) => {
  try {
    // Frees the space of expired stories; never throws (see ../stories.js).
    await sweepExpiredStories();

    // Nobody in a block relation with me, in either direction (F-13).
    const [rows] = await pool.query(
      `${STORY_QUERY}
        WHERE ${STORY_LIVE} AND ${notBlockedWith('s.user_id')}
        ORDER BY seen ASC, s.created_at DESC, s.id DESC
        LIMIT ${STORY_LIMIT}`,
      [req.user.id, req.user.id, req.user.id, req.user.id],
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
    // Someone in a block relation answers like an account that does not exist (F-13).
    if (await hiddenByBlock(req.user.id, owner.id)) {
      throw new HttpError(404, 'Dieses Konto gibt es nicht.');
    }
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
      v.add('image', MSG_IMAGE_TYPE);
    }
    if (caption.length > MAX_CAPTION) {
      v.add('caption', `Die Unterschrift fasst hoechstens ${MAX_CAPTION} Zeichen.`);
    } else {
      // Feste Liste vor der KI – sie greift auch ohne Schluessel und bei Ausfall.
      rejectBlockedTerms(v, 'caption', req.body?.caption, 'text'); // as it came, any JSON type (F-06)
    }
    v.throwIfFails();

    // A real image, encoded again without metadata, before anything looks at it (F-11).
    const image = await processImageOr422(req.file, 'image', MSG_IMAGE_TYPE);

    // KI-Verifizierung VOR dem Speichern – wie bei Events und Beitraegen.
    const check = await moderateContent({
      user: req.user,
      context: 'story',
      // Only the user's text, no placeholder of ours in the user-data slot (F-06).
      description: caption,
      image,
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

    const imagePath = await storeImage('stories', image);

    const [result] = await pool.query(
      `INSERT INTO stories (user_id, caption, image_path, created_at, expires_at)
       VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [req.user.id, caption || null, imagePath, STORY_HOURS],
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

/**
 * GET /api/media/stories/:file  (geschuetzt) – the image of a running story (F-11, F-13).
 *
 * Story images are private (storage.js) and leave the server only here: for a signed-in viewer,
 * while the story runs, and not across a block (storyImageVisible in ../stories.js). Everything
 * else, an expired story included, is the same 404. The app sends its bearer token with the
 * image request (src/domain/auth-image.ts).
 */
router.get('/media/stories/:file', requireAuth, async (req, res, next) => {
  try {
    const file = String(req.params.file);
    if (!STORED_NAME.test(file) || !(await storyImageVisible(`stories/${file}`, req.user))) {
      return res.status(404).json({ message: 'Diese Story gibt es nicht mehr.' });
    }
    return sendPrivateFile(res, next, 'stories', file);
  } catch (err) {
    return next(err);
  }
});

// POST /api/stories/:id/view  (geschuetzt) – als gesehen merken (idempotent).
router.post('/stories/:id/view', requireAuth, rateLimit('state'), async (req, res, next) => {
  try {
    const story = await first('SELECT id, user_id FROM stories WHERE id = ? AND expires_at > NOW()', [
      req.params.id,
    ]);
    // A story of someone in a block relation answers like one that has expired (F-13), and no
    // view is recorded.
    if (!story || (await hiddenByBlock(req.user.id, story.user_id))) {
      throw new HttpError(404, 'Diese Story gibt es nicht mehr.');
    }

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
    // Best effort, never throws (storage.js): the story is gone either way.
    if (story.image_path) await removeStored(story.image_path);
    res.json({ message: 'Story geloescht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
