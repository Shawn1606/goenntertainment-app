/**
 * Business-Bereich: Zahlen zu den eigenen Events und das Hervorheben.
 *
 * Erreichbar ab der Stufe Business (siehe accounts.js). Alles hier antwortet
 * ausschliesslich mit EIGENEN Events – ein Business-Konto sieht keine fremden
 * Zahlen.
 *
 * Zum Umsatz: Die App hat keine Bezahl-Events (kein Preis am Event, keine
 * Zahlungen in der Datenbank). Deshalb steht hier keine erfundene Zahl, sondern
 * `revenue.available = false` mit Begruendung – und daneben die Buchungen, auf
 * denen ein Umsatz spaeter aufsetzt. Sobald es Zahlungen gibt, wird aus dieser
 * einen Stelle eine echte Summe.
 */
import { createRouter } from '../router.js';
import { pool, first, toIso } from '../db.js';
import { requireAuth } from '../auth.js';
import { HttpError } from '../validate.js';
import { abilitiesFor, BOOST_DAYS } from '../accounts.js';

const router = createRouter();

/** Wie viele Events die Uebersicht hoechstens auflistet. */
const EVENT_LIMIT = 50;

/**
 * DB-Datum aus einem JS-Date: 'YYYY-MM-DD HH:MM:SS' in UTC.
 *
 * Bewusst in JS gerechnet und nicht mit NOW()/UTC_TIMESTAMP(): Die Datenbank
 * liefert Datumsspalten als rohe UTC-Strings (dateStrings, siehe db.js), und
 * NOW() haengt an der Zeitzone der Verbindung. So vergleichen wir UTC mit UTC.
 */
function sqlDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Erster Tag des Monats, der `months - 1` Monate zurueckliegt (UTC). */
function windowStart(now, months) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0));
}

/**
 * Verlangt eine Business-Stufe. Laeuft NACH requireAuth.
 *
 * Admins bekommen hier bewusst KEINE Ausnahme: Der Business-Bereich folgt der
 * eingestellten Stufe, sonst koennte ein Admin nie pruefen, was ein
 * Standard-Konto sieht (siehe accounts.js).
 */
function requireBusiness(req, res, next) {
  if (!abilitiesFor(req.user).hasBusinessArea) {
    return res.status(403).json({ message: 'Dieser Bereich gehoert zu den Business-Konten.' });
  }
  return next();
}

/**
 * Monats-Reihe ohne Luecken: Die Datenbank liefert nur Monate mit Eintraegen,
 * ein Diagramm braucht aber jeden Monat – auch den mit der 0.
 */
function monthSeries(now, months, counts) {
  const out = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ month, count: Number(counts.get(month) ?? 0) });
  }
  return out;
}

/** Zaehlt pro Monat – gemeinsame Form fuer Buchungen und Aufrufe. */
async function countsByMonth(sql, params) {
  const [rows] = await pool.query(sql, params);
  return new Map(rows.map((r) => [r.month, Number(r.c)]));
}

// GET /api/business/insights  (geschuetzt, ab Business)
router.get('/insights', requireAuth, requireBusiness, async (req, res, next) => {
  try {
    const abilities = abilitiesFor(req.user);
    const months = abilities.insightMonths;
    const now = new Date();
    const nowSql = sqlDate(now);
    const fromSql = sqlDate(windowStart(now, months));
    const me = req.user.id;

    // Eine Abfrage fuer alle Summen – jede Unterabfrage haengt an den eigenen
    // Events. `au.user_id <> a.user_id` laesst den eigenen Auto-Beitritt aussen
    // vor: Der Host zaehlt nicht als Buchung.
    const totals = await first(
      `SELECT
         (SELECT COUNT(*) FROM activities WHERE user_id = ?) AS events,
         (SELECT COUNT(*) FROM activity_views v
            JOIN activities a ON a.id = v.activity_id WHERE a.user_id = ?) AS views,
         (SELECT COUNT(DISTINCT v.user_id) FROM activity_views v
            JOIN activities a ON a.id = v.activity_id WHERE a.user_id = ?) AS visitors,
         (SELECT COUNT(*) FROM activity_user au
            JOIN activities a ON a.id = au.activity_id
           WHERE a.user_id = ? AND au.user_id <> a.user_id) AS bookings,
         (SELECT COUNT(*) FROM activities
           WHERE user_id = ? AND boosted_until IS NOT NULL AND boosted_until > ?) AS boosted`,
      [me, me, me, me, me, nowSql],
    );

    const bookingsByMonth = await countsByMonth(
      `SELECT DATE_FORMAT(au.created_at, '%Y-%m') AS month, COUNT(*) AS c
         FROM activity_user au
         JOIN activities a ON a.id = au.activity_id
        WHERE a.user_id = ? AND au.user_id <> a.user_id AND au.created_at >= ?
        GROUP BY month`,
      [me, fromSql],
    );

    const viewsByMonth = await countsByMonth(
      `SELECT DATE_FORMAT(v.created_at, '%Y-%m') AS month, COUNT(*) AS c
         FROM activity_views v
         JOIN activities a ON a.id = v.activity_id
        WHERE a.user_id = ? AND v.created_at >= ?
        GROUP BY month`,
      [me, fromSql],
    );

    // Eigene Events: Anstehendes zuerst (das Naechste oben), Vergangenes danach.
    // Genau in der Reihenfolge braucht man die Liste zum Hervorheben.
    const [eventRows] = await pool.query(
      `SELECT a.id, a.title, a.starts_at, a.boosted_until, a.max_participants,
              (SELECT COUNT(*) FROM activity_views v WHERE v.activity_id = a.id) AS views,
              (SELECT COUNT(*) FROM activity_user au
                WHERE au.activity_id = a.id AND au.user_id <> a.user_id) AS bookings
         FROM activities a
        WHERE a.user_id = ?
        ORDER BY (a.starts_at >= ?) DESC,
                 CASE WHEN a.starts_at >= ? THEN a.starts_at END ASC,
                 a.starts_at DESC
        LIMIT ${EVENT_LIMIT}`,
      [me, nowSql, nowSql],
    );

    res.json({
      account_type: req.user.account_type,
      months,
      revenue: {
        // Keine erfundene Zahl: Es gibt weder einen Preis am Event noch
        // Zahlungen in der Datenbank. Die App zeigt genau das an.
        available: false,
        currency: 'EUR',
        gross_cents: 0,
        reason: 'Bezahl-Events sind noch nicht angebunden – deshalb steht hier noch kein Umsatz.',
      },
      bookings: {
        total: Number(totals?.bookings ?? 0),
        series: monthSeries(now, months, bookingsByMonth),
      },
      reach: {
        events: Number(totals?.events ?? 0),
        views: Number(totals?.views ?? 0),
        visitors: Number(totals?.visitors ?? 0),
        series: monthSeries(now, months, viewsByMonth),
      },
      boost: {
        slots: abilities.boostSlots,
        used: Number(totals?.boosted ?? 0),
        days: BOOST_DAYS,
      },
      events: eventRows.map((row) => ({
        id: row.id,
        title: row.title,
        starts_at: toIso(row.starts_at),
        boosted_until: toIso(row.boosted_until),
        max_participants: row.max_participants ?? null,
        views: Number(row.views),
        bookings: Number(row.bookings),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** Eigenes Event laden oder mit dem passenden Fehler abbrechen. */
async function ownActivity(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    throw new HttpError(404, 'Aktivitaet nicht gefunden.');
  }
  const activity = await first('SELECT id, user_id, boosted_until FROM activities WHERE id = ?', [id]);
  if (!activity) {
    throw new HttpError(404, 'Aktivitaet nicht gefunden.');
  }
  // Auch fuer Admins: Hervorheben ist eine Sache des eigenen Auftritts, nicht
  // der Moderation. Fremde Events bleiben tabu.
  if (activity.user_id !== req.user.id) {
    throw new HttpError(403, 'Das ist nicht dein Event.');
  }
  return activity;
}

// POST /api/business/activities/:id/boost  (geschuetzt, ab Business)
// Hebt ein eigenes Event fuer BOOST_DAYS Tage hervor: Die Empfehlungen der App
// ziehen es dadurch nach vorne (siehe src/domain/recommendations.ts).
router.post('/activities/:id/boost', requireAuth, requireBusiness, async (req, res, next) => {
  try {
    const activity = await ownActivity(req);
    const { boostSlots } = abilitiesFor(req.user);
    const now = new Date();
    const nowSql = sqlDate(now);

    // Belegte Plaetze zaehlen – das Event selbst ausgenommen, damit ein
    // Verlaengern nicht am eigenen Boost scheitert.
    const inUse = await first(
      `SELECT COUNT(*) AS c FROM activities
        WHERE user_id = ? AND id <> ? AND boosted_until IS NOT NULL AND boosted_until > ?`,
      [req.user.id, activity.id, nowSql],
    );

    if (Number(inUse?.c ?? 0) >= boostSlots) {
      throw new HttpError(
        422,
        boostSlots === 1
          ? 'Du kannst ein Event gleichzeitig hervorheben. Nimm die Hervorhebung beim anderen Event zuerst weg.'
          : `Du kannst ${boostSlots} Events gleichzeitig hervorheben. Nimm die Hervorhebung bei einem anderen Event zuerst weg.`,
      );
    }

    const until = sqlDate(new Date(now.getTime() + BOOST_DAYS * 86400000));
    await pool.query('UPDATE activities SET boosted_until = ?, updated_at = NOW() WHERE id = ?', [
      until,
      activity.id,
    ]);

    res.json({ id: activity.id, boosted_until: toIso(until) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/business/activities/:id/boost  (geschuetzt, ab Business)
router.delete('/activities/:id/boost', requireAuth, requireBusiness, async (req, res, next) => {
  try {
    const activity = await ownActivity(req);
    await pool.query('UPDATE activities SET boosted_until = NULL, updated_at = NOW() WHERE id = ?', [
      activity.id,
    ]);
    res.json({ id: activity.id, boosted_until: null });
  } catch (err) {
    next(err);
  }
});

export default router;
