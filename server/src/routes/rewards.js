/**
 * Praemien: Punktestand, Katalog und Einloesen.
 *
 * Die Rechenregeln stehen in src/rewards.js – hier liegt nur der Weg nach
 * draussen. Der Katalog geht mit der Antwort mit, obwohl die App ihn auch selbst
 * kennt: So bleibt eine aeltere App-Version lesbar, wenn ein Coupon dazukommt,
 * und der Preis, gegen den der Server prueft, ist immer der angezeigte.
 */
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { HttpError } from '../validate.js';
import { toIso } from '../db.js';
import {
  COUPONS,
  POINTS_PER_ACTIVITY,
  backfillActivityPoints,
  balanceFor,
  couponFor,
  redeemCoupon,
  redemptionsFor,
} from '../rewards.js';

const router = Router();

/** Einloesung in die API-Form bringen (mit dem Text des Coupons dazu). */
function transformRedemption(row) {
  const coupon = couponFor(row.coupon_slug);
  return {
    id: row.id,
    coupon_slug: row.coupon_slug,
    // Titel aus dem Katalog, damit die App fuer alte Einloesungen keinen
    // Platzhalter zeigen muss. Ein aus dem Katalog entfernter Coupon behaelt
    // seinen Schluessel als Notnagel – besser als eine leere Zeile.
    title: coupon?.title ?? row.coupon_slug,
    code: row.code,
    points: Number(row.points),
    created_at: toIso(row.created_at),
  };
}

// GET /api/me/rewards  (geschuetzt) – Punktestand, Katalog, eigene Coupons.
router.get('/me/rewards', requireAuth, async (req, res, next) => {
  try {
    // Erst nachtragen, dann rechnen: sonst zeigt der erste Aufruf eines
    // Bestandskontos 0 Punkte und der zweite ploetzlich den echten Stand.
    await backfillActivityPoints(req.user.id).catch(() => {});

    const [totals, redemptions] = await Promise.all([
      balanceFor(req.user.id),
      redemptionsFor(req.user.id),
    ]);

    res.json({
      points: totals,
      pointsPerActivity: POINTS_PER_ACTIVITY,
      coupons: COUPONS,
      redemptions: redemptions.map(transformRedemption),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/me/rewards/redeem  (geschuetzt) – Coupon gegen Punkte.
router.post('/me/rewards/redeem', requireAuth, async (req, res, next) => {
  try {
    const slug = String(req.body?.coupon ?? '').trim();
    const result = await redeemCoupon(req.user.id, slug);

    if (!result.ok) {
      if (result.reason === 'unknown') {
        throw new HttpError(422, 'Diese Praemie gibt es nicht.', {
          coupon: ['Diese Praemie gibt es nicht.'],
        });
      }
      // 422 und nicht 403: Es fehlt nichts an der Berechtigung, sondern am
      // Punktestand – und die App soll die fehlende Zahl anzeigen koennen.
      throw new HttpError(422, `Dir fehlen noch ${result.missing} Punkte.`, {
        coupon: [`Dir fehlen noch ${result.missing} Punkte.`],
      });
    }

    const totals = await balanceFor(req.user.id);
    res.status(201).json({
      // Zeitpunkt aus der Uhr statt aus einem zweiten SELECT: Die Zeile ist
      // gerade eben mit NOW() entstanden, der Unterschied liegt im Millisekunden-
      // Bereich – und die App zeigt ohnehin nur das Datum. Format wie die
      // DB-Spalte ('YYYY-MM-DD HH:MM:SS'), damit `toIso` damit umgehen kann.
      data: transformRedemption({
        ...result.redemption,
        created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      }),
      points: totals,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
