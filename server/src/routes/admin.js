import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

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
      [[recentUsers]],
      [[recentJoins]],
      [signupRows],
      [joinRows],
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS c FROM users'),
      pool.query('SELECT COUNT(*) AS c FROM activities'),
      pool.query('SELECT COUNT(*) AS c FROM activity_user'),
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

export default router;
