/**
 * Oeffentliche Profilseite: Stufe, Beitraege und Social-Links.
 *
 * Wer ein Profil hat, entscheidet die Kontostufe (accounts.js): ab Creator ja,
 * Standard nein. Das gilt fuer BEIDE Richtungen – ein Standard-Konto hat keine
 * Seite, die andere aufrufen koennten, und kann selbst nichts posten.
 *
 * Admins bekommen hier bewusst KEINE Ausnahme (anders als beim Anlegen von
 * Events): Ein Profil ist ein eigener Auftritt, kein Werkzeug der Moderation.
 * Genau dieselbe Regel steht in src/domain/account.ts.
 *
 * Gelesen wird von allen Angemeldeten – geschrieben nur am eigenen Profil.
 */
import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { pool, first, toIso } from '../db.js';
import { requireAuth, userPayload } from '../auth.js';
import { HttpError, Validator } from '../validate.js';
import { abilitiesFor } from '../accounts.js';
import { parseLinkList } from '../social.js';
import { moderateContent, fieldErrorsFor } from '../moderation.js';
import { mediaUrl, publicBase } from '../media.js';

const router = Router();

const POST_DIR = path.join(process.cwd(), 'storage', 'posts');
/** Profilbilder und Karten-Hintergruende ("Banner") des Kontos. */
const AVATAR_DIR = path.join(process.cwd(), 'storage', 'avatars');
const USER_BANNER_DIR = path.join(process.cwd(), 'storage', 'user-banners');
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** So viele Beitraege liefert ein Profil hoechstens aus. */
const POST_LIMIT = 50;
/** Laenge eines Beitrags – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_BODY = 1000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

/**
 * Multer mit eigener Fehlerbehandlung.
 *
 * Ohne das landet ein zu grosses Bild beim allgemeinen Fehler-Handler in
 * app.js – und der spricht von einem „Banner-Bild", das es bei einem Beitrag
 * gar nicht gibt.
 */
function uploadImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) {
      return next();
    }
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

/** Beitrag in die API-Form bringen. */
function transformPost(req, row) {
  return {
    id: row.id,
    body: row.body,
    image_url: row.image_path ? `${publicBase(req)}/storage/${row.image_path}` : null,
    created_at: toIso(row.created_at),
  };
}

/** Verlangt ein eigenes oeffentliches Profil. Laeuft NACH requireAuth. */
function requireProfile(req, res, next) {
  if (!abilitiesFor(req.user).hasPublicProfile) {
    return res.status(403).json({
      message: 'Ein oeffentliches Profil gibt es ab der Stufe Creator.',
    });
  }
  return next();
}

/** Die Links eines Kontos, in stabiler Reihenfolge. */
async function loadLinks(userId) {
  const [rows] = await pool.query(
    'SELECT platform, url FROM user_links WHERE user_id = ? ORDER BY id',
    [userId],
  );
  return rows.map((r) => ({ platform: r.platform, url: r.url }));
}

/** So viele Treffer liefert die Nutzersuche hoechstens. */
const SEARCH_LIMIT = 30;

// GET /api/users?q=…  (geschuetzt) – Leute suchen (Name oder Benutzername).
//
// Gibt es, seit der Freunde-Bereich eine Suche braucht, die zu PERSONEN fuehrt.
// Bewusst nur Name und Benutzername und bewusst kein leeres `q`: Eine Suche ohne
// Suchwort waere ein Verzeichnis aller Konten, und das ist etwas anderes als eine
// Suche. E-Mail-Adressen bleiben draussen – sonst waere die Suche ein Weg,
// Adressen abzugleichen, die niemand veroeffentlicht hat.
router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const term = String(req.query?.q ?? '').trim();
    if (term.length < 2) {
      return res.json({ data: [] });
    }

    const like = `%${term.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.account_type,
              f.status AS friend_status, f.requester_id AS friend_requester
         FROM users u
    LEFT JOIN friendships f
           ON (f.requester_id = u.id AND f.addressee_id = ?)
           OR (f.addressee_id = u.id AND f.requester_id = ?)
        WHERE u.id <> ?
          AND (u.banned_until IS NULL OR u.banned_until <= NOW())
          AND (u.name LIKE ? OR u.username LIKE ?)
        ORDER BY (u.username = ?) DESC, u.name ASC
        LIMIT ${SEARCH_LIMIT}`,
      [req.user.id, req.user.id, req.user.id, like, like, term],
    );

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        avatar: mediaUrl(req, row.avatar),
        account_type: row.account_type,
        // Was die App fuer diese Person anbieten soll: anfragen, annehmen,
        // warten oder nichts. Den Zustand hier mitzugeben erspart der Suche
        // einen zweiten Aufruf pro Treffer.
        friendship: friendshipStateFor(row, req.user.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Beziehungszustand aus Sicht der:des Suchenden.
 *
 * 'none' · 'friends' · 'incoming' (die andere Person hat angefragt) ·
 * 'outgoing' (ich habe angefragt).
 */
function friendshipStateFor(row, meId) {
  if (!row.friend_status) return 'none';
  if (row.friend_status === 'accepted') return 'friends';
  return Number(row.friend_requester) === Number(meId) ? 'outgoing' : 'incoming';
}

// GET /api/users/:username  (geschuetzt) – Profil einer Person.
//
// Jedes Konto mit Benutzernamen hat eine Seite: Seit der Freunde-Bereich zu
// Profilen fuehrt, waere ein 404 fuer Standard-Konten eine Sackgasse mitten im
// Ablauf. Was die Stufe entscheidet, ist der INHALT: Beitraege und Social-Links
// gibt es ab Creator (`hasPublicProfile`), darunter bleibt die Seite eine
// Visitenkarte mit Zahlen. Schreiben darf ohnehin nur, wer die Stufe hat – das
// prueft `requireProfile` weiter unten.
//
// 404 bleibt fuer einen unbekannten Namen: Dass es ein Konto gibt, verraet die
// Antwort nur, wenn man den Benutzernamen schon kennt.
router.get('/users/:username', requireAuth, async (req, res, next) => {
  try {
    const user = await first(
      `SELECT id, name, username, avatar, banner, account_type, is_admin, banned_until, created_at
         FROM users WHERE username = ?`,
      [req.params.username],
    );

    if (!user) throw new HttpError(404, 'Dieses Profil gibt es nicht.');

    const showsPosts = abilitiesFor(user).hasPublicProfile;

    const [posts] = showsPosts
      ? await pool.query(
          `SELECT id, body, image_path, created_at FROM posts
            WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${POST_LIMIT}`,
          [user.id],
        )
      : [[]];

    // Zahlen des Auftritts: veranstaltet und mitgemacht. Der eigene
    // Auto-Beitritt zaehlt nicht als „mitgemacht" (sonst zaehlte jedes eigene
    // Event doppelt).
    const stats = await first(
      `SELECT
         (SELECT COUNT(*) FROM activities WHERE user_id = ?) AS hosted,
         (SELECT COUNT(*) FROM activity_user au
            JOIN activities a ON a.id = au.activity_id
           WHERE au.user_id = ? AND a.user_id <> ?) AS joined,
         (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts`,
      [user.id, user.id, user.id, user.id],
    );

    // Beziehung zur:zum Aufrufer:in – damit „Freund:in hinzufuegen" direkt auf
    // dem Profil steht und nicht nur in der Suche.
    const relation =
      user.id === req.user.id
        ? null
        : await first(
            `SELECT status, requester_id FROM friendships
              WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
            [req.user.id, user.id, user.id, req.user.id],
          );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: mediaUrl(req, user.avatar),
        /** Liegt in der App weichgezeichnet hinter der Profil-Karte. */
        banner: mediaUrl(req, user.banner),
        account_type: user.account_type,
        is_admin: Boolean(user.is_admin),
        created_at: toIso(user.created_at),
      },
      links: showsPosts ? await loadLinks(user.id) : [],
      posts: posts.map((row) => transformPost(req, row)),
      stats: {
        hosted: Number(stats?.hosted ?? 0),
        joined: Number(stats?.joined ?? 0),
        posts: Number(stats?.posts ?? 0),
      },
      /** false = Visitenkarte ohne Beitraege und Links (Stufe Standard). */
      shows_posts: showsPosts,
      friendship: relation
        ? friendshipStateFor(
            { friend_status: relation.status, friend_requester: relation.requester_id },
            req.user.id,
          )
        : 'none',
      is_me: user.id === req.user.id,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/me/links  (geschuetzt, ab Creator) – ersetzt ALLE Links.
//
// Ersetzen statt einzeln pflegen: Das Formular kennt ohnehin den vollstaendigen
// Stand, und so gibt es keine halb gespeicherten Zwischenzustaende.
router.put('/me/links', requireAuth, requireProfile, async (req, res, next) => {
  try {
    const { links, error } = parseLinkList(req.body?.links);
    if (error) {
      throw new HttpError(422, error, { links: [error] });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM user_links WHERE user_id = ?', [req.user.id]);
      if (links.length > 0) {
        const rows = links.map(() => '(?, ?, ?, NOW(), NOW())').join(', ');
        const params = links.flatMap((l) => [req.user.id, l.platform, l.url]);
        await connection.query(
          `INSERT INTO user_links (user_id, platform, url, created_at, updated_at) VALUES ${rows}`,
          params,
        );
      }
      await connection.commit();
    } catch (err) {
      // Sonst bliebe das Profil ohne Links zurueck, weil das DELETE schon lief.
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    res.json({ links: await loadLinks(req.user.id) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------- Profilbild und Karten-Hintergrund */

/**
 * Die zwei Bilder eines Kontos.
 *
 * Beide liegen in derselben Tabelle und laufen durch denselben Ablauf – was sie
 * unterscheidet, steht hier und nicht in zwei fast gleichen Endpunkten.
 * `banner` heisst so, weil die App es als Hintergrund der Profil-Karte
 * weichzeichnet; mit dem `banner_path` einer Aktivitaet hat es nichts zu tun,
 * deshalb liegt es auch in einem eigenen Ordner.
 */
const IMAGE_KINDS = {
  avatar: { column: 'avatar', dir: AVATAR_DIR, folder: 'avatars', label: 'Profilbild' },
  banner: { column: 'banner', dir: USER_BANNER_DIR, folder: 'user-banners', label: 'Banner' },
};

/**
 * Loescht eine Datei, die zu einem Spaltenwert gehoert.
 *
 * Fremde URLs bleiben unberuehrt: Bei Google-Konten steht in `avatar` eine
 * Adresse bei Google, und die gehoert uns nicht (siehe src/media.js). Ein
 * fehlgeschlagenes Loeschen darf den Aufruf nicht kippen – das Bild ist
 * ersetzt, das ist die Hauptsache.
 */
function removeStoredImage(value) {
  if (!value || /^https?:\/\//i.test(String(value))) {
    return;
  }
  try {
    fs.unlinkSync(path.join(process.cwd(), 'storage', value));
  } catch {
    /* Datei evtl. schon weg. */
  }
}

/** Konto neu laden und als API-User ausliefern (mit fertigen Bild-Adressen). */
async function respondWithUser(req, res) {
  const row = await first('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: await userPayload(row, req) });
}

/**
 * Bild setzen. Ein Handler fuer beide Sorten, `kind` sagt welche.
 *
 * Die KI-Verifizierung laeuft VOR dem Speichern, wie bei Events und Beitraegen:
 * Ein Profilbild ist das Erste, was andere von einem Konto sehen – es waere die
 * offensichtlichste Luecke, wenn gerade das ungeprueft durchgeht.
 */
function setProfileImage(kind) {
  const spec = IMAGE_KINDS[kind];
  return async (req, res, next) => {
    try {
      if (!req.file) {
        throw new HttpError(422, `Waehle zuerst ein ${spec.label}.`, {
          image: [`Waehle zuerst ein ${spec.label}.`],
        });
      }
      if (!ALLOWED_MIME.includes(req.file.mimetype)) {
        throw new HttpError(422, 'Das Bild muss jpeg, png oder webp sein.', {
          image: ['Das Bild muss jpeg, png oder webp sein.'],
        });
      }

      const check = await moderateContent({
        user: req.user,
        context: 'profile',
        description: spec.label,
        image: { buffer: req.file.buffer, mimetype: req.file.mimetype },
      });

      if (!check.allowed) {
        if (check.timedOut) {
          return res.status(403).json({
            message: 'Dein Konto wurde automatisch gesperrt: Das Bild war nicht jugendfrei.',
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
          check.reason ?? 'Dieses Bild ist nicht jugendfrei.',
          fieldErrorsFor(check, { bild: 'image', beschreibung: 'image', titel: 'image' }),
        );
      }

      fs.mkdirSync(spec.dir, { recursive: true });
      const name = `${crypto.randomBytes(20).toString('hex')}.${EXT_BY_MIME[req.file.mimetype]}`;
      fs.writeFileSync(path.join(spec.dir, name), req.file.buffer);

      // Erst das neue Bild eintragen, dann das alte wegwerfen: Kippt das UPDATE,
      // zeigt das Konto weiter auf ein Bild, das es noch gibt.
      const previous = req.user[spec.column] ?? null;
      await pool.query(
        `UPDATE users SET ${spec.column} = ?, updated_at = NOW() WHERE id = ?`,
        [`${spec.folder}/${name}`, req.user.id],
      );
      removeStoredImage(previous);

      await respondWithUser(req, res);
    } catch (err) {
      next(err);
    }
  };
}

/** Bild entfernen. Ohne Bild ist das kein Fehler – danach ist ohnehin keins da. */
function clearProfileImage(kind) {
  const spec = IMAGE_KINDS[kind];
  return async (req, res, next) => {
    try {
      const previous = req.user[spec.column] ?? null;
      await pool.query(
        `UPDATE users SET ${spec.column} = NULL, updated_at = NOW() WHERE id = ?`,
        [req.user.id],
      );
      removeStoredImage(previous);
      await respondWithUser(req, res);
    } catch (err) {
      next(err);
    }
  };
}

// POST/DELETE /api/me/avatar und /api/me/banner  (geschuetzt, multipart wegen Bild)
//
// Bewusst OHNE `requireProfile`: Ein Gesicht und ein Hintergrund gehoeren zu
// jedem Konto. Die Stufe entscheidet, ob es Beitraege und Social-Links gibt
// (siehe oben) – nicht, ob man ein Profilbild haben darf.
router.post('/me/avatar', requireAuth, uploadImage, setProfileImage('avatar'));
router.delete('/me/avatar', requireAuth, clearProfileImage('avatar'));
router.post('/me/banner', requireAuth, uploadImage, setProfileImage('banner'));
router.delete('/me/banner', requireAuth, clearProfileImage('banner'));

// POST /api/posts  (geschuetzt, ab Creator; multipart wegen Bild)
router.post('/posts', requireAuth, requireProfile, uploadImage, async (req, res, next) => {
  try {
    const body = String(req.body?.body ?? '').trim();
    const v = new Validator(req.body ?? {});

    if (!body) v.add('body', 'Schreib etwas, bevor du den Beitrag veroeffentlichst.');
    else if (body.length > MAX_BODY) v.add('body', `Ein Beitrag fasst hoechstens ${MAX_BODY} Zeichen.`);
    if (req.file && !ALLOWED_MIME.includes(req.file.mimetype)) {
      v.add('image', 'Das Bild muss jpeg, png oder webp sein.');
    }
    v.throwIfFails();

    // KI-Verifizierung VOR dem Speichern – wie bei den Events. Ab der
    // eingestellten Schwere sperrt die Moderation das Konto automatisch.
    const check = await moderateContent({
      user: req.user,
      context: 'post',
      description: body,
      image: req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : null,
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
      // Ein Beitrag hat weder Titel noch Interessen: Alles zeigt auf den Text
      // bzw. das Bild.
      throw new HttpError(
        422,
        check.reason ?? 'Dieser Inhalt ist nicht jugendfrei.',
        fieldErrorsFor(check, { beschreibung: 'body', titel: 'body', bild: 'image' }),
      );
    }

    let imagePath = null;
    if (req.file) {
      fs.mkdirSync(POST_DIR, { recursive: true });
      const name = `${crypto.randomBytes(20).toString('hex')}.${EXT_BY_MIME[req.file.mimetype]}`;
      fs.writeFileSync(path.join(POST_DIR, name), req.file.buffer);
      imagePath = `posts/${name}`;
    }

    const [result] = await pool.query(
      'INSERT INTO posts (user_id, body, image_path, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [req.user.id, body, imagePath],
    );

    const row = await first('SELECT id, body, image_path, created_at FROM posts WHERE id = ?', [
      result.insertId,
    ]);
    res.status(201).json({ data: transformPost(req, row) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:id  (geschuetzt) – eigener Beitrag; Admins jeden.
router.delete('/posts/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await first('SELECT id, user_id, image_path FROM posts WHERE id = ?', [req.params.id]);
    if (!post) throw new HttpError(404, 'Diesen Beitrag gibt es nicht.');

    // Admin darf aufraeumen, alle anderen nur bei sich selbst.
    if (!req.user.is_admin && post.user_id !== req.user.id) {
      throw new HttpError(403, 'Du kannst nur eigene Beitraege loeschen.');
    }

    await pool.query('DELETE FROM posts WHERE id = ?', [post.id]);

    // Bild mitnehmen – anders als bei Event-Bannern haengt an einem Beitrag
    // kein Verlaufs-Eintrag, das Bild wird also von niemandem mehr gebraucht.
    if (post.image_path) {
      try {
        fs.unlinkSync(path.join(process.cwd(), 'storage', post.image_path));
      } catch {
        /* Datei evtl. schon weg – das darf das Loeschen nicht kippen. */
      }
    }

    res.json({ message: 'Beitrag geloescht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
