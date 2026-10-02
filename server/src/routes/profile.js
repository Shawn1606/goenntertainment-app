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
import { createRouter } from '../router.js';
import { pool, first, toIso } from '../db.js';
import { requireAuth, userPayload } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { HttpError, Validator } from '../validate.js';
import { BLOCKED_TERMS, blockedTermMessageFor, findBlockedTerm, rejectBlockedTerms } from '../blocked-terms.js';
import { abilitiesFor } from '../accounts.js';
import { linkFilterTexts, parseLinkList } from '../social.js';
import { moderateContent, fieldErrorsFor } from '../moderation.js';
import { mediaUrl } from '../media.js';
import { blockExistsBetween, hiddenByBlock, notBlockedWith, transformUser, USER_COLUMNS } from '../people.js';
import { follow, followCounts, isFollowing, unfollow } from '../follows.js';
import { notifyFollowers, notifyOnce, notifyQuietly } from '../notifications.js';
import { attachStories, storiesOf } from '../stories.js';
import { singleUpload } from '../uploads.js';
import { ALLOWED_MIME, processImageOr422 } from '../images.js';
import { removeStored, storeImage } from '../storage.js';

const router = createRouter();

const MSG_IMAGE_TYPE = 'Das Bild muss jpeg, png oder webp sein.';

/** So viele Beitraege liefert ein Profil hoechstens aus. */
const POST_LIMIT = 50;
/** Laenge eines Beitrags – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_BODY = 1000;
/** Laenge eines Kommentars – dieselbe Zahl wie die Spalte in schema.sql. */
const MAX_COMMENT = 500;
/** So viele Kommentare liefert ein Beitrag hoechstens aus. */
const COMMENT_LIMIT = 100;

/**
 * Image in the field `image` (5 MB with its own message, uploads.js) plus at most the text field
 * `body` (posts), with some headroom.
 */
const uploadImage = singleUpload('image', { maxFields: 3 });

/**
 * Beitrag in die API-Form bringen.
 *
 * `likes_count`/`comments_count`/`liked_by_me` kommen aus der Abfrage mit; fehlen
 * sie (aeltere Aufrufer), stehen sie auf 0 bzw. false statt undefined – die App
 * rechnet mit Zahlen, nicht mit „vielleicht".
 *
 * `edited` sagt, ob der Text nach dem Veroeffentlichen noch angefasst wurde. Das
 * gehoert sichtbar dazu: Ein Beitrag, unter dem schon kommentiert wurde, darf
 * sich nicht unbemerkt aendern.
 */
function transformPost(req, row) {
  return {
    id: row.id,
    body: row.body,
    image_url: mediaUrl(req, row.image_path),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at ?? null),
    edited: Boolean(row.updated_at && row.created_at && row.updated_at !== row.created_at),
    likes_count: Number(row.likes_count ?? 0),
    comments_count: Number(row.comments_count ?? 0),
    liked_by_me: Boolean(row.liked_by_me),
  };
}

/**
 * Die Spalten eines Beitrags samt Zahlen – einmal formuliert, dreimal benutzt
 * (Profil, Anlegen, Bearbeiten). Zwei Unterabfragen statt zweier JOINs mit
 * GROUP BY: Bei zwei unabhaengigen Zaehlungen multipliziert ein JOIN die Zeilen,
 * und das faellt erst auf, wenn jemand kommentiert UND liked.
 */
const POST_SELECT = `
  p.id, p.body, p.image_path, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)      AS likes_count,
  (SELECT COUNT(*) FROM post_comments pc
    WHERE pc.post_id = p.id
      AND NOT EXISTS (SELECT 1 FROM user_blocks b
                       WHERE (b.blocker_id = pc.user_id AND b.blocked_id = ?)
                          OR (b.blocker_id = ? AND b.blocked_id = pc.user_id))) AS comments_count,
  EXISTS(SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = ?) AS liked_by_me
`;

/**
 * The bound values POST_SELECT takes, in its order: the viewer twice for `comments_count`, which
 * leaves out comments of anyone in a block relation with the viewer - the same rule as the
 * comment list (GET /posts/:id/comments), so the number under a post matches what it lists (F-08,
 * F-13) - then the viewer for `liked_by_me`.
 */
const postSelectParams = (viewerId) => [viewerId, viewerId, viewerId];

/** Einen Beitrag frisch laden – mit den Zahlen aus Sicht von `viewerId`. */
function loadPost(postId, viewerId) {
  return first(`SELECT ${POST_SELECT} FROM posts p WHERE p.id = ?`, [...postSelectParams(viewerId), postId]);
}

/**
 * Die Nutzerspalten eines Kommentars.
 *
 * Bewusst ausgeschrieben statt aus `USER_COLUMNS` abgeleitet: Dort steht `u.id`
 * an erster Stelle, und in einem JOIN mit `post_comments` traegt `id` schon die
 * Kommentar-ID. `u.id` wuerde sie im Ergebnis still ueberschreiben – mysql2
 * behaelt bei gleichnamigen Spalten die letzte.
 */
const COMMENT_USER_COLUMNS =
  'u.id AS user_id, u.name, u.username, u.avatar, u.account_type';

/** Ein Kommentar in die API-Form. `viewer` ist das aufrufende Konto (req.user). */
function transformComment(req, row, viewer, postAuthorId) {
  return {
    id: row.id,
    body: row.body,
    created_at: toIso(row.created_at),
    // Loeschen darf: wer ihn geschrieben hat, und wem der Beitrag gehoert. Das
    // Zweite ist wichtig – sonst braeuchte man fuer jeden unerwuenschten
    // Kommentar unter dem eigenen Beitrag einen Admin. And an admin, as the delete route
    // (DELETE /comments/:id) already allows: a reported comment can then be removed in place
    // (F-08), like an event comment.
    can_delete:
      Boolean(viewer.is_admin) ||
      Number(row.user_id) === Number(viewer.id) ||
      Number(postAuthorId) === Number(viewer.id),
    user: transformUser(req, {
      id: row.user_id,
      name: row.name,
      username: row.username,
      avatar: row.avatar,
      account_type: row.account_type,
    }),
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

/**
 * Longest search term: a name holds at most 255 characters (users.name in schema.sql), so a
 * longer term can match nothing. It is answered with no results before any pattern runs (F-02).
 */
const MAX_SEARCH_TERM = 255;

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
    if (term.length < 2 || term.length > MAX_SEARCH_TERM) {
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
          -- A block in either direction: neither finds the other (F-13).
          AND ${notBlockedWith('u.id')}
          AND (u.name LIKE ? OR u.username LIKE ?)
        ORDER BY (u.username = ?) DESC, u.name ASC
        LIMIT ${SEARCH_LIMIT}`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, like, like, term],
    );

    res.json({
      // `attachStories` haengt jeder Zeile an, ob hinter ihrem Bild eine Story
      // liegt – EINE Abfrage fuer alle Treffer, nicht eine je Zeile. Ohne das
      // waere der Ring in der Trefferliste geraten.
      data: await attachStories(
        rows.map((row) => ({
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
        req.user.id,
      ),
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
    // No `is_admin` here: whether an account is an admin is told only to that account itself
    // (F-05), and that answer comes from the viewer's own row (`req.user`, see below).
    const user = await first(
      `SELECT id, name, username, avatar, banner, account_type, banned_until, created_at
         FROM users WHERE username = ?`,
      [req.params.username],
    );

    // A block in either direction answers like an unknown name (F-13): the same 404 and text.
    if (!user || (await hiddenByBlock(req.user.id, user.id))) {
      throw new HttpError(404, 'Dieses Profil gibt es nicht.');
    }

    const showsPosts = abilitiesFor(user).hasPublicProfile;

    const [posts] = showsPosts
      ? await pool.query(
          `SELECT ${POST_SELECT} FROM posts p
            WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ${POST_LIMIT}`,
          [...postSelectParams(req.user.id), user.id],
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

    // Folgen ist einseitig und unabhaengig von der Freundschaft – beide Zahlen
    // stehen deshalb neben und nicht statt „befreundet".
    const counts = await followCounts(user.id);
    const following = user.id === req.user.id ? false : await isFollowing(req.user.id, user.id);
    /** Folgt die Person MIR? Daraus wird in der App „Folgt dir". */
    const followsMe = user.id === req.user.id ? false : await isFollowing(user.id, req.user.id);
    const isMe = user.id === req.user.id;

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        avatar: mediaUrl(req, user.avatar),
        /** Liegt in der App weichgezeichnet hinter der Profil-Karte. */
        banner: mediaUrl(req, user.banner),
        account_type: user.account_type,
        // Only on the viewer's own profile (F-05). On anyone else's the field is left out, so
        // looking through profiles does not tell who the admins are.
        ...(isMe ? { is_admin: Boolean(req.user.is_admin) } : {}),
        created_at: toIso(user.created_at),
      },
      links: showsPosts ? await loadLinks(user.id) : [],
      posts: posts.map((row) => transformPost(req, row)),
      /**
       * Die laufenden Storys dieser Person – der Ring um ihr Profilbild.
       *
       * Steht in DIESER Antwort und nicht in einem zweiten Aufruf: Der Ring muss
       * beim ersten Bild dieser Seite schon richtig aussehen, sonst erscheint er
       * nachtraeglich und die Karte zuckt. Die Bilder braucht die Seite ohnehin,
       * denn ein Tipp auf das Profilbild oeffnet sie direkt.
       *
       * Auch fuer Standard-Konten (nicht an `showsPosts` gebunden): Wer keine
       * Storys anlegen darf, hat einfach keine – dann ist die Liste leer, und das
       * ist die richtige Antwort statt einer weggelassenen.
       */
      stories: await storiesOf(req, user.id, req.user.id),
      stats: {
        hosted: Number(stats?.hosted ?? 0),
        joined: Number(stats?.joined ?? 0),
        posts: Number(stats?.posts ?? 0),
        followers: counts.followers,
        following: counts.following,
      },
      /** Folge ich dieser Person? Traegt den Knopf auf der Profilkarte. */
      is_following: following,
      /** Folgt sie mir? Nur eine Beschriftung – kein Recht haengt daran. */
      follows_me: followsMe,
      /** false = Visitenkarte ohne Beitraege und Links (Stufe Standard). */
      shows_posts: showsPosts,
      friendship: relation
        ? friendshipStateFor(
            { friend_status: relation.status, friend_requester: relation.requester_id },
            req.user.id,
          )
        : 'none',
      is_me: isMe,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------- Folgen */

/**
 * Das Konto, dem gefolgt werden soll – mit allen Gruenden, warum das nicht geht.
 *
 * Bewusst KEINE Stufen-Pruefung: Man folgt einer Person, nicht ihrem Profil.
 * Wer heute Standard ist und morgen Creator wird, soll seine Follower schon
 * haben – sonst waere Folgen erst ab dem Moment moeglich, in dem es ohnehin
 * schon etwas zu sehen gibt.
 */
async function followTarget(req) {
  const target = await first(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, [
    Number(req.params.id) || 0,
  ]);
  if (!target) throw new HttpError(404, 'Dieses Konto gibt es nicht.');
  if (Number(target.id) === Number(req.user.id)) {
    throw new HttpError(422, 'Dir selbst zu folgen ergibt keinen Sinn.');
  }
  if (await blockExistsBetween(req.user.id, target.id)) {
    // Dieselbe Meldung wie bei einer Freundschaftsanfrage: Ob ich blockiert wurde
    // oder selbst blockiert habe, geht aus der Antwort bewusst nicht hervor.
    throw new HttpError(403, 'Das geht mit diesem Konto nicht.');
  }
  return target;
}

// POST /api/users/:id/follow  (geschuetzt) – folgen. Idempotent.
router.post('/users/:id/follow', requireAuth, rateLimit('relationship'), async (req, res, next) => {
  try {
    const target = await followTarget(req);
    const fresh = await follow(req.user.id, target.id);

    // Nur bei einer WIRKLICH neuen Folge – sonst meldet jedes erneute Tippen auf
    // ein schon gefolgtes Profil noch einmal.
    // After an unfollow the next follow is new to `follows` again: notifyOnce writes no second
    // row for the same follower (F-07, follow/unfollow loop).
    if (fresh) {
      await notifyOnce({
        userId: target.id,
        actorId: req.user.id,
        type: 'follow',
        refId: req.user.id,
        title: `${req.user.name} folgt dir jetzt`,
      });
    }

    res.json({ is_following: true, ...(await followCounts(target.id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id/follow  (geschuetzt) – nicht mehr folgen.
//
// Ohne `followTarget`: Entfolgen muss auch dann gehen, wenn die andere Seite
// inzwischen blockiert hat – sonst haenge ich in einem Abo fest, das ich nicht
// mehr loswerde.
router.delete('/users/:id/follow', requireAuth, rateLimit('relationship'), async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0;
    await unfollow(req.user.id, id);
    res.json({ is_following: false, ...(await followCounts(id)) });
  } catch (err) {
    next(err);
  }
});

/** Follower bzw. Gefolgte eines Kontos – dieselbe Liste, andere Spalte. */
function followList(direction) {
  // 'followers' = wer folgt dieser Person; 'following' = wem folgt sie.
  const [known, wanted] =
    direction === 'followers' ? ['following_id', 'follower_id'] : ['follower_id', 'following_id'];

  return async (req, res, next) => {
    try {
      const target = await first('SELECT id FROM users WHERE username = ?', [req.params.username]);
      // The lists of someone in a block relation answer like an unknown profile (F-13).
      if (!target || (await hiddenByBlock(req.user.id, target.id))) {
        throw new HttpError(404, 'Dieses Profil gibt es nicht.');
      }

      const [rows] = await pool.query(
        `SELECT ${USER_COLUMNS},
                EXISTS(SELECT 1 FROM follows me
                        WHERE me.follower_id = ? AND me.following_id = u.id) AS is_following
           FROM follows f
           JOIN users u ON u.id = f.${wanted}
          WHERE f.${known} = ?
            AND (u.banned_until IS NULL OR u.banned_until <= NOW())
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks b
               WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
                  OR (b.blocker_id = ? AND b.blocked_id = u.id)
            )
          ORDER BY f.created_at DESC
          LIMIT ${SEARCH_LIMIT}`,
        [req.user.id, target.id, req.user.id, req.user.id],
      );

      res.json({
        data: rows.map((row) => ({
          ...transformUser(req, row),
          is_following: Boolean(row.is_following),
        })),
      });
    } catch (err) {
      next(err);
    }
  };
}

// GET /api/users/:username/followers und /following  (geschuetzt)
router.get('/users/:username/followers', requireAuth, followList('followers'));
router.get('/users/:username/following', requireAuth, followList('following'));

// PUT /api/me/links  (geschuetzt, ab Creator) – ersetzt ALLE Links.
//
// Ersetzen statt einzeln pflegen: Das Formular kennt ohnehin den vollstaendigen
// Stand, und so gibt es keine halb gespeicherten Zwischenzustaende.
router.put('/me/links', requireAuth, rateLimit('content'), requireProfile, async (req, res, next) => {
  try {
    const { links, error } = parseLinkList(req.body?.links);
    if (error) {
      throw new HttpError(422, error, { links: [error] });
    }
    // Links stand on the profile like any text: the fixed list checks their words, and each of
    // their parts as a post's text, too (F-06).
    if (links.some((link) => linkFilterTexts(link.url).some((text) => findBlockedTerm(text, BLOCKED_TERMS, 'text')))) {
      const message = blockedTermMessageFor('text');
      throw new HttpError(422, message, { links: [message] });
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
  avatar: { column: 'avatar', folder: 'avatars', label: 'Profilbild' },
  banner: { column: 'banner', folder: 'user-banners', label: 'Banner' },
};

/**
 * Loescht eine Datei, die zu einem Spaltenwert gehoert.
 *
 * Fremde URLs bleiben unberuehrt: Bei Google-Konten steht in `avatar` eine
 * Adresse bei Google, und die gehoert uns nicht (siehe src/media.js). Ein
 * fehlgeschlagenes Loeschen darf den Aufruf nicht kippen – das Bild ist
 * ersetzt, das ist die Hauptsache.
 */
async function removeStoredImage(value) {
  // Foreign addresses and unknown folders are left alone by storage.js; never throws.
  await removeStored(value);
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
        throw new HttpError(422, MSG_IMAGE_TYPE, { image: [MSG_IMAGE_TYPE] });
      }
      // A real image, encoded again without metadata, before anything looks at it (F-11).
      const image = await processImageOr422(req.file, 'image', MSG_IMAGE_TYPE);

      const check = await moderateContent({
        user: req.user,
        context: 'profile',
        // Code-made, not user text: where the image goes (buildModerationText 'verwendung').
        label: spec.label,
        image,
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

      const stored = await storeImage(spec.folder, image);

      // Erst das neue Bild eintragen, dann das alte wegwerfen: Kippt das UPDATE,
      // zeigt das Konto weiter auf ein Bild, das es noch gibt.
      const previous = req.user[spec.column] ?? null;
      await pool.query(
        `UPDATE users SET ${spec.column} = ?, updated_at = NOW() WHERE id = ?`,
        [stored, req.user.id],
      );
      await removeStoredImage(previous);

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
      await removeStoredImage(previous);
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
router.post('/me/avatar', requireAuth, rateLimit('moderated'), uploadImage, setProfileImage('avatar'));
router.delete('/me/avatar', requireAuth, rateLimit('content'), clearProfileImage('avatar'));
router.post('/me/banner', requireAuth, rateLimit('moderated'), uploadImage, setProfileImage('banner'));
router.delete('/me/banner', requireAuth, rateLimit('content'), clearProfileImage('banner'));

// POST /api/posts  (geschuetzt, ab Creator; multipart wegen Bild)
router.post('/posts', requireAuth, rateLimit('moderated'), requireProfile, uploadImage, async (req, res, next) => {
  try {
    const body = String(req.body?.body ?? '').trim();
    const v = new Validator(req.body ?? {});

    // Text ODER Bild – nicht zwingend beides.
    //
    // Vorher war der Text Pflicht. Das steht dem im Weg, was hier gewuenscht ist:
    // ein Foto hochladen und die Beschreibung spaeter dazuschreiben (siehe PATCH
    // weiter unten). Ganz leer bleibt verboten – das waere kein Beitrag.
    if (!body && !req.file) {
      v.add('body', 'Schreib etwas oder waehle ein Bild, bevor du veroeffentlichst.');
    } else if (body.length > MAX_BODY) {
      v.add('body', `Ein Beitrag fasst hoechstens ${MAX_BODY} Zeichen.`);
    } else {
      // Feste Liste vor der KI – sie greift auch ohne Schluessel und bei Ausfall. The value as it
      // came, any JSON type (F-06).
      rejectBlockedTerms(v, 'body', req.body?.body, 'text');
    }
    if (req.file && !ALLOWED_MIME.includes(req.file.mimetype)) {
      v.add('image', MSG_IMAGE_TYPE);
    }
    v.throwIfFails();

    // A real image, encoded again without metadata, before anything looks at it (F-11).
    const image = req.file ? await processImageOr422(req.file, 'image', MSG_IMAGE_TYPE) : null;

    // KI-Verifizierung VOR dem Speichern – wie bei den Events. Ab der
    // eingestellten Schwere sperrt die Moderation das Konto automatisch.
    const check = await moderateContent({
      user: req.user,
      context: 'post',
      // Only the user's text, no placeholder of ours in the user-data slot (F-06).
      description: body,
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
      // Ein Beitrag hat weder Titel noch Interessen: Alles zeigt auf den Text
      // bzw. das Bild.
      throw new HttpError(
        422,
        check.reason ?? 'Dieser Inhalt ist nicht jugendfrei.',
        fieldErrorsFor(check, { beschreibung: 'body', titel: 'body', bild: 'image' }),
      );
    }

    const imagePath = image ? await storeImage('posts', image) : null;

    const [result] = await pool.query(
      'INSERT INTO posts (user_id, body, image_path, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [req.user.id, body, imagePath],
    );

    // Follower informieren. Laeuft NACH dem Speichern und schluckt seine Fehler
    // (siehe notifications.js): Der Beitrag steht, egal ob der Verteiler klappt.
    await notifyFollowers(req.user, {
      type: 'post',
      refId: result.insertId,
      // Umlaute, weil das ANZEIGETEXT ist – siehe die Notiz in stories.js.
      title: `${req.user.name} hat einen Beitrag veröffentlicht`,
      body: body || null,
    });

    res.status(201).json({ data: transformPost(req, await loadPost(result.insertId, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/posts/:id  (geschuetzt) – Beschreibung nachtraeglich setzen/aendern.
//
// Nur der Text, nicht das Bild: Ein ausgetauschtes Bild unter einem Beitrag, den
// schon jemand geliked oder kommentiert hat, waere ein anderer Beitrag – dafuer
// gibt es Loeschen und neu anlegen. Der Text laeuft durch dieselbe
// KI-Verifizierung wie beim Anlegen, sonst waere Bearbeiten die Luecke, durch die
// man sie umgeht.
router.patch('/posts/:id', requireAuth, rateLimit('moderated'), async (req, res, next) => {
  try {
    const post = await first('SELECT id, user_id, image_path FROM posts WHERE id = ?', [
      req.params.id,
    ]);
    if (!post) throw new HttpError(404, 'Diesen Beitrag gibt es nicht.');
    // Bewusst KEINE Admin-Ausnahme: Ein Admin darf aufraeumen (loeschen), aber
    // nicht in fremdem Namen formulieren.
    if (Number(post.user_id) !== Number(req.user.id)) {
      throw new HttpError(403, 'Du kannst nur eigene Beitraege bearbeiten.');
    }

    const body = String(req.body?.body ?? '').trim();
    const v = new Validator(req.body ?? {});
    if (!body && !post.image_path) {
      v.add('body', 'Ein Beitrag ohne Bild braucht einen Text.');
    } else if (body.length > MAX_BODY) {
      v.add('body', `Ein Beitrag fasst hoechstens ${MAX_BODY} Zeichen.`);
    } else {
      rejectBlockedTerms(v, 'body', req.body?.body, 'text'); // as it came, any JSON type (F-06)
    }
    v.throwIfFails();

    if (body) {
      const check = await moderateContent({
        user: req.user,
        context: 'post',
        description: body,
        image: null,
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
          fieldErrorsFor(check, { beschreibung: 'body', titel: 'body', bild: 'body' }),
        );
      }
    }

    await pool.query('UPDATE posts SET body = ?, updated_at = NOW() WHERE id = ?', [body, post.id]);
    res.json({ data: transformPost(req, await loadPost(post.id, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------- Gefaellt mir und Kommentare */

/** Der Beitrag zu :id – oder ein 404. Traegt auch die:den Verfasser:in. */
async function loadPostOr404(id) {
  const post = await first('SELECT id, user_id, body FROM posts WHERE id = ?', [Number(id) || 0]);
  if (!post) throw new HttpError(404, 'Diesen Beitrag gibt es nicht.');
  return post;
}

// POST /api/posts/:id/like  (geschuetzt) – idempotent.
router.post('/posts/:id/like', requireAuth, rateLimit('reaction'), async (req, res, next) => {
  try {
    const post = await loadPostOr404(req.params.id);
    if (await blockExistsBetween(req.user.id, post.user_id)) {
      throw new HttpError(403, 'Das geht mit diesem Konto nicht.');
    }

    const [result] = await pool.query(
      `INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [post.id, req.user.id],
    );

    // Nur beim ERSTEN Mal melden – sonst waere Like/Unlike/Like eine Glocke,
    // die man beliebig oft laeuten kann.
    // A fresh row in post_likes alone is not "the first time": after an unlike the next like is
    // fresh again. notifyOnce writes no second row for the same fan and post (F-07).
    if (result.affectedRows === 1) {
      await notifyOnce({
        userId: post.user_id,
        actorId: req.user.id,
        type: 'like',
        refId: post.id,
        title: `${req.user.name} gefällt dein Beitrag`,
        body: post.body || null,
      });
    }

    res.json({ data: transformPost(req, await loadPost(post.id, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:id/like  (geschuetzt) – Gefaellt mir zuruecknehmen.
router.delete('/posts/:id/like', requireAuth, rateLimit('reaction'), async (req, res, next) => {
  try {
    const post = await loadPostOr404(req.params.id);
    // Withdrawing one's own like always works, also after a block (F-13) ...
    await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [
      post.id,
      req.user.id,
    ]);
    // ... but the answer shows the post only to someone it is not hidden from.
    if (await hiddenByBlock(req.user.id, post.user_id)) {
      throw new HttpError(404, 'Diesen Beitrag gibt es nicht.');
    }
    res.json({ data: transformPost(req, await loadPost(post.id, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

// GET /api/posts/:id/comments  (geschuetzt) – aelteste zuerst.
//
// Anders als im Chat: Unter einem Beitrag liest man von oben nach unten, und der
// erste Kommentar ist der, auf den sich die spaeteren beziehen.
router.get('/posts/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const post = await loadPostOr404(req.params.id);
    // The post of someone in a block relation answers like a post that does not exist (F-13).
    if (await hiddenByBlock(req.user.id, post.user_id)) {
      throw new HttpError(404, 'Diesen Beitrag gibt es nicht.');
    }
    const [rows] = await pool.query(
      `SELECT c.id, c.body, c.created_at, ${COMMENT_USER_COLUMNS}
         FROM post_comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.post_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
             WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
                OR (b.blocker_id = ? AND b.blocked_id = u.id)
          )
        ORDER BY c.id ASC
        LIMIT ${COMMENT_LIMIT}`,
      [post.id, req.user.id, req.user.id],
    );

    res.json({
      data: rows.map((row) => transformComment(req, row, req.user, post.user_id)),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/posts/:id/comments  (geschuetzt)
//
// Bewusst OHNE `requireProfile`: Kommentieren darf jedes Konto. Die Stufe
// entscheidet, wer einen eigenen Auftritt hat – nicht, wer mitreden darf.
router.post('/posts/:id/comments', requireAuth, rateLimit('comment'), async (req, res, next) => {
  try {
    const post = await loadPostOr404(req.params.id);
    if (await blockExistsBetween(req.user.id, post.user_id)) {
      throw new HttpError(403, 'Das geht mit diesem Konto nicht.');
    }

    const body = String(req.body?.body ?? '').trim();
    const v = new Validator(req.body ?? {});
    if (!body) v.add('body', 'Schreib etwas, bevor du kommentierst.');
    else if (body.length > MAX_COMMENT) {
      v.add('body', `Ein Kommentar fasst hoechstens ${MAX_COMMENT} Zeichen.`);
    } else rejectBlockedTerms(v, 'body', req.body?.body, 'text'); // as it came, any JSON type (F-06)
    v.throwIfFails();

    // Kommentare laufen durch dieselbe KI-Verifizierung wie Beitraege: Sonst
    // waere der Kommentarbereich die eine Stelle, an der ungeprueft alles
    // durchgeht – und zwar unter fremdem Namen auf fremdem Profil.
    const check = await moderateContent({
      user: req.user,
      context: 'post',
      description: body,
      image: null,
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
        fieldErrorsFor(check, { beschreibung: 'body', titel: 'body', bild: 'body' }),
      );
    }

    const [result] = await pool.query(
      'INSERT INTO post_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, NOW())',
      [post.id, req.user.id, body],
    );

    await notifyQuietly({
      userId: post.user_id,
      actorId: req.user.id,
      type: 'comment',
      refId: post.id,
      title: `${req.user.name} hat deinen Beitrag kommentiert`,
      body,
    });

    const row = await first(
      `SELECT c.id, c.body, c.created_at, ${COMMENT_USER_COLUMNS}
         FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      [result.insertId],
    );

    res.status(201).json({
      data: transformComment(req, row, req.user, post.user_id),
      post: transformPost(req, await loadPost(post.id, req.user.id)),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/comments/:id  (geschuetzt) – eigener Kommentar, eigener Beitrag, Admin.
router.delete('/comments/:id', requireAuth, rateLimit('content'), async (req, res, next) => {
  try {
    const row = await first(
      `SELECT c.id, c.user_id, c.post_id, p.user_id AS post_user_id
         FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`,
      [req.params.id],
    );
    if (!row) throw new HttpError(404, 'Diesen Kommentar gibt es nicht.');

    const mayDelete =
      req.user.is_admin ||
      Number(row.user_id) === Number(req.user.id) ||
      Number(row.post_user_id) === Number(req.user.id);
    if (!mayDelete) throw new HttpError(403, 'Das darfst du nicht.');

    await pool.query('DELETE FROM post_comments WHERE id = ?', [row.id]);
    res.json({ data: transformPost(req, await loadPost(row.post_id, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/posts/:id  (geschuetzt) – eigener Beitrag; Admins jeden.
router.delete('/posts/:id', requireAuth, rateLimit('content'), async (req, res, next) => {
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
    // Best effort, never throws (storage.js): the post is gone either way.
    if (post.image_path) await removeStored(post.image_path);

    res.json({ message: 'Beitrag geloescht.' });
  } catch (err) {
    next(err);
  }
});

export default router;
