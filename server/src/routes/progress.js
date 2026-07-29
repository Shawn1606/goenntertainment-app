import { Router } from 'express';
import { pool, first } from '../db.js';
import { requireAuth } from '../auth.js';
import { mediaUrl } from '../media.js';
import { emptyStats, xpFromStats, xpSqlExpression } from '../gamification.js';
import { activeDaysFor, markActiveDay } from '../streak.js';

const router = Router();

/** Wie viele Plaetze das Leaderboard maximal zeigt. */
const LEADERBOARD_LIMIT = 50;

/** XP-Formel auf den Alias-Spalten der Kennzahlen-Abfrage. */
const XP_EXPR = xpSqlExpression({ hosted: 'hosted', joined: 'joined', distinctInterests: 'variety' });

/**
 * Kennzahlen je Nutzer als Unterabfrage:
 *  hosted  = selbst erstellte Events
 *  joined  = Events, bei denen man dabei ist (das eigene zaehlt mit)
 *  variety = wie viele verschiedene Kategorien dabei vorkamen
 *
 * `columns` erlaubt zusaetzliche Nutzerspalten (fuer das Leaderboard).
 */
function statsQuery(columns = '') {
  return `
    SELECT ${columns}
           (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS hosted,
           (SELECT COUNT(*) FROM activity_user au WHERE au.user_id = u.id) AS joined,
           (SELECT COUNT(DISTINCT ai.interest_id)
              FROM activity_user au2
              JOIN activity_interest ai ON ai.activity_id = au2.activity_id
             WHERE au2.user_id = u.id) AS variety
      FROM users u
  `;
}

function toStats(row) {
  return {
    hosted: Number(row.hosted),
    joined: Number(row.joined),
    distinctInterests: Number(row.variety),
  };
}

async function statsFor(userId) {
  const row = await first(`${statsQuery()} WHERE u.id = ?`, [userId]);
  return row ? toStats(row) : emptyStats();
}

// GET /api/me/progress  (geschuetzt) – eigene Kennzahlen + XP + aktive Tage.
// Level, Titel, Abzeichen und die Serie berechnet die App daraus selbst
// (src/domain/gamification.ts bzw. src/domain/streak.ts), damit die Anzeige
// sofort reagiert und die Regeln testbar an einer Stelle liegen.
router.get('/me/progress', requireAuth, async (req, res, next) => {
  try {
    // Diesen Aufruf macht die App bei jedem Blick auf die Startseite – er ist
    // damit der ehrlichste Zeitpunkt fuer "heute war jemand da". `req.query.day`
    // ist das lokale Datum des Geraets; fehlt es, nimmt der Server sein eigenes.
    // Erst markieren, dann lesen, damit der heutige Tag sofort mitzaehlt.
    await markActiveDay(req.user.id, req.query.day).catch(() => {});

    const [stats, activeDates] = await Promise.all([
      statsFor(req.user.id),
      // Faellt die Serien-Tabelle aus, ist das kein Grund, den Fortschritt zu
      // verweigern: dann eben ohne Serie.
      activeDaysFor(req.user.id).catch(() => []),
    ]);
    res.json({ stats, xp: xpFromStats(stats), activeDates });
  } catch (err) {
    next(err);
  }
});

// GET /api/leaderboard  (geschuetzt) – Top-Liste nach XP + eigene Position.
router.get('/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, username, avatar, hosted, joined, variety, ${XP_EXPR} AS xp
         FROM (${statsQuery('u.id, u.name, u.username, u.avatar,')}) AS s
        ORDER BY xp DESC, id ASC
        LIMIT ?`,
      [LEADERBOARD_LIMIT],
    );

    const data = rows.map((r, index) => ({
      rank: index + 1,
      xp: Number(r.xp),
      stats: toStats(r),
      user: { id: r.id, name: r.name, username: r.username, avatar: mediaUrl(req, r.avatar) },
    }));

    // Eigene Position: aus der Top-Liste, sonst zaehlen, wie viele davor liegen.
    let me = data.find((entry) => entry.user.id === req.user.id) ?? null;
    if (!me) {
      const stats = await statsFor(req.user.id);
      const xp = xpFromStats(stats);
      const ahead = await first(
        `SELECT COUNT(*) AS c FROM (${statsQuery('u.id,')}) AS s WHERE ${XP_EXPR} > ?`,
        [xp],
      );
      me = {
        rank: Number(ahead?.c ?? 0) + 1,
        xp,
        stats,
        user: {
          id: req.user.id,
          name: req.user.name,
          username: req.user.username,
          avatar: mediaUrl(req, req.user.avatar),
        },
      };
    }

    res.json({ data, me });
  } catch (err) {
    next(err);
  }
});

export default router;
