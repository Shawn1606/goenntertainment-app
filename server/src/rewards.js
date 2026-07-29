/**
 * Praemien: Punkte sammeln, Coupons einloesen.
 *
 * ## Warum Punkte NEBEN den XP existieren
 *
 * XP (gamification.js) sind eine reine Ableitung aus dem aktuellen Stand: Wer ein
 * Event loescht, verliert seine XP wieder – das ist bei einem Level in Ordnung,
 * bei einer Waehrung aber nicht. Ein Coupon, der schon eingeloest ist, laesst sich
 * nicht zurueckholen; ein Punktestand, der von selbst sinkt, wuerde also negativ
 * werden koennen.
 *
 * Punkte liegen deshalb als **Buchungen** in `reward_points` und nicht als
 * Formel: Wer ein Event erstellt, bekommt eine Zeile mit 10 Punkten, und die
 * bleibt auch dann stehen, wenn das Event spaeter weg ist (`activity_id` faellt
 * per ON DELETE SET NULL auf NULL). Guthaben = Summe der Buchungen minus Summe
 * der eingeloesten Coupons.
 *
 * ## Der Katalog steht im Code, nicht in der Datenbank
 *
 * Gleiche Entscheidung wie bei den Kontostufen (accounts.js): Ein Coupon hat
 * Text, Preis und Symbol – aendert sich einer davon, ist das eine Zeile hier und
 * kein Datenbank-Eingriff. Die App kennt denselben Katalog in
 * `src/domain/rewards.ts`; server/test/rewards.test.js und
 * src/domain/rewards.test.ts halten beide Seiten fest.
 */
import crypto from 'node:crypto';
import { pool, first } from './db.js';

/** Punkte fuer eine erstellte Aktivitaet. Gleiche Zahl wie src/domain/rewards.ts. */
export const POINTS_PER_ACTIVITY = 10;

/**
 * Der Katalog. `slug` ist der Schluessel, unter dem eine Einloesung gespeichert
 * wird – er darf sich nie aendern, sonst verlieren alte Einloesungen ihren Namen.
 *
 * ACHTUNG, Umlaute: Titel und Beschreibung gehen 1:1 in die Oberflaeche und
 * stehen dort als Ueberschrift. Sie sind deshalb – anders als die Kommentare in
 * diesem Server – mit echten Umlauten geschrieben. Express setzt bei `res.json()`
 * `charset=utf-8`, das kommt also richtig an. Wer hier etwas aendert: bitte keine
 * ae/oe/ue-Ersatzschreibweise, sonst steht „Heissgetraenk" in der App.
 */
export const COUPONS = [
  {
    slug: 'kaffee',
    title: 'Kaffee aufs Haus',
    description: 'Ein Heißgetränk bei einem teilnehmenden Café.',
    cost: 50,
    icon: 'sparkles',
  },
  {
    slug: 'eiskugel',
    title: 'Eine Kugel Eis gratis',
    description: 'Bei teilnehmenden Eisdielen in der Innenstadt.',
    cost: 60,
    icon: 'balloon',
  },
  {
    slug: 'kino-2fuer1',
    title: 'Kino: 2 für 1',
    description: 'Zwei Tickets zum Preis von einem, Mo bis Do.',
    cost: 120,
    icon: 'ticket',
  },
  {
    slug: 'schwimmbad',
    title: 'Tageskarte Schwimmbad',
    description: 'Einmal freier Eintritt bei einem Partnerbad.',
    cost: 200,
    icon: 'compass',
  },
  {
    slug: 'sportkurs',
    title: 'Probetraining gratis',
    description: 'Eine Einheit bei einem Partner-Studio oder -Verein.',
    cost: 260,
    icon: 'rocket',
  },
  {
    slug: 'beutel',
    title: 'GÖ4Fun-Beutel',
    description: 'Stoffbeutel mit Wortmarke – solange der Vorrat reicht.',
    cost: 400,
    icon: 'trophy',
  },
];

/** Coupon zu einem Schluessel; null, wenn es ihn (nicht mehr) gibt. */
export function couponFor(slug) {
  return COUPONS.find((coupon) => coupon.slug === slug) ?? null;
}

/**
 * Erzeugt den Code, der beim Partner vorgezeigt wird.
 *
 * Bewusst kurz, in Grossbuchstaben und ohne 0/O/1/I: Der Code wird vom Display
 * abgelesen und oft abgetippt. Vier Bloecke a vier Zeichen aus 30 Zeichen sind
 * ~78 Bit – genug, dass niemand einen fremden Code errät.
 */
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

/**
 * Buchung fuer eine erstellte Aktivitaet.
 *
 * `INSERT IGNORE` gegen den eindeutigen Schluessel (user_id, reason, activity_id):
 * Ein doppelter Aufruf – etwa weil der Nachtrag unten dasselbe Event nochmal
 * sieht – darf keine zweiten 10 Punkte geben.
 */
export async function awardActivityPoints(userId, activityId) {
  await pool.query(
    `INSERT IGNORE INTO reward_points (user_id, points, reason, activity_id, created_at)
     VALUES (?, ?, 'activity', ?, NOW())`,
    [userId, POINTS_PER_ACTIVITY, activityId],
  );
}

/**
 * Traegt Punkte fuer Events nach, die vor dem Punktesystem entstanden sind.
 *
 * Laeuft bei jedem Blick auf die Praemien und ist idempotent (derselbe eindeutige
 * Schluessel wie oben). Ohne diesen Nachtrag stuende jedes Bestandskonto bei 0,
 * obwohl es Events erstellt hat – und der erste Eindruck des neuen Bereichs waere
 * „meine Arbeit zaehlt nicht".
 */
export async function backfillActivityPoints(userId) {
  await pool.query(
    `INSERT IGNORE INTO reward_points (user_id, points, reason, activity_id, created_at)
     SELECT user_id, ?, 'activity', id, NOW() FROM activities WHERE user_id = ?`,
    [POINTS_PER_ACTIVITY, userId],
  );
}

/** Gesammelt, ausgegeben und was uebrig ist. */
export async function balanceFor(userId) {
  const row = await first(
    `SELECT
       (SELECT COALESCE(SUM(points), 0) FROM reward_points WHERE user_id = ?) AS earned,
       (SELECT COALESCE(SUM(points), 0) FROM reward_redemptions WHERE user_id = ?) AS spent`,
    [userId, userId],
  );
  const earned = Number(row?.earned ?? 0);
  const spent = Number(row?.spent ?? 0);
  // `Math.max` ist hier nur ein Sicherheitsnetz: Die Einloesung unten prueft das
  // Guthaben in derselben Transaktion, ein negativer Stand kann also nicht
  // entstehen. Sollte er doch einmal in den Daten stehen, ist 0 die ehrlichere
  // Anzeige als eine Minuszahl, mit der niemand etwas anfangen kann.
  return { earned, spent, balance: Math.max(0, earned - spent) };
}

/** Die eigenen Coupons, neueste zuerst. */
export async function redemptionsFor(userId) {
  const [rows] = await pool.query(
    `SELECT id, coupon_slug, code, points, created_at
       FROM reward_redemptions WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    [userId],
  );
  return rows;
}

/**
 * Coupon einloesen.
 *
 * Laeuft in einer Transaktion mit `FOR UPDATE` auf den Buchungen: Zwei parallele
 * Aufrufe (Doppeltipp, zweites Geraet) wuerden sonst beide dasselbe Guthaben
 * sehen und zusammen mehr ausgeben, als da ist.
 *
 * @returns {Promise<{ok: true, redemption: object} | {ok: false, reason: 'unknown'|'insufficient', missing?: number}>}
 */
export async function redeemCoupon(userId, slug) {
  const coupon = couponFor(slug);
  if (!coupon) {
    return { ok: false, reason: 'unknown' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [[earnedRow]] = await connection.query(
      'SELECT COALESCE(SUM(points), 0) AS total FROM reward_points WHERE user_id = ? FOR UPDATE',
      [userId],
    );
    const [[spentRow]] = await connection.query(
      'SELECT COALESCE(SUM(points), 0) AS total FROM reward_redemptions WHERE user_id = ? FOR UPDATE',
      [userId],
    );

    const balance = Number(earnedRow.total) - Number(spentRow.total);
    if (balance < coupon.cost) {
      await connection.rollback();
      return { ok: false, reason: 'insufficient', missing: coupon.cost - balance };
    }

    const code = makeCode();
    const [result] = await connection.query(
      `INSERT INTO reward_redemptions (user_id, coupon_slug, code, points, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [userId, coupon.slug, code, coupon.cost],
    );
    await connection.commit();

    return {
      ok: true,
      redemption: { id: result.insertId, coupon_slug: coupon.slug, code, points: coupon.cost },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
