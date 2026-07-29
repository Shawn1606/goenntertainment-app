/**
 * Prämien: Punkte und Coupons – reine Rechenlogik, kein React.
 *
 * ## Punkte sind nicht XP
 *
 * XP (`gamification.ts`) sind eine Ableitung aus dem aktuellen Stand und können
 * wieder sinken – bei einem Level ist das in Ordnung. Punkte sind eine **Währung**:
 * Wer einen Coupon eingelöst hat, kann ihn nicht zurückgeben, also darf der Stand
 * nicht von selbst fallen. Deshalb bucht der Server jede Gutschrift einmalig
 * (server/src/rewards.js) und die App rechnet hier nur noch damit.
 *
 * ## Der Katalog steht zweimal – mit Absicht
 *
 * Einmal hier, einmal im Server. Die App braucht ihn, um Preise und Texte auch
 * ohne Netz zeigen zu können; der Server braucht ihn, weil nur er entscheiden
 * darf, ob das Guthaben reicht. Die Antwort von `/api/me/rewards` bringt den
 * Katalog des Servers mit – ist er neuer als dieser hier, gilt er. Diese Datei ist
 * also die Vorgabe, nicht die Wahrheit.
 *
 * `src/domain/rewards.test.ts` hält die Zahlen fest, `server/test/rewards.test.js`
 * dieselben auf der anderen Seite.
 */
import type { UiIconName } from './ui-icon.ts';

/** Punkte für eine erstellte Aktivität. Gleiche Zahl wie server/src/rewards.js. */
export const POINTS_PER_ACTIVITY = 10;

export type Coupon = {
  /** Unveränderlicher Schlüssel – daran hängen alte Einlösungen. */
  slug: string;
  title: string;
  description: string;
  /** Preis in Punkten. */
  cost: number;
  icon: UiIconName;
};

/** Aufsteigend nach Preis: So liest die Liste sich von „gleich dran" nach „Ziel". */
export const COUPONS: readonly Coupon[] = [
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
] as const;

/** Coupon zu einem Schlüssel; `null`, wenn es ihn (nicht mehr) gibt. */
export function couponFor(slug: string, catalog: readonly Coupon[] = COUPONS): Coupon | null {
  return catalog.find((coupon) => coupon.slug === slug) ?? null;
}

/** Punkte für eine Anzahl erstellter Aktivitäten. */
export function pointsForActivities(count: number): number {
  const safe = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  return safe * POINTS_PER_ACTIVITY;
}

/** Reicht das Guthaben? */
export function canAfford(coupon: Coupon, balance: number): boolean {
  return balance >= coupon.cost;
}

/** Wie weit man auf einen Coupon zu ist – 0..1, für den Balken. */
export function couponProgress(coupon: Coupon, balance: number): number {
  if (coupon.cost <= 0) return 1;
  const safe = Math.max(0, Number.isFinite(balance) ? balance : 0);
  return Math.min(1, safe / coupon.cost);
}

/**
 * Der nächste Coupon, auf den es sich zuzuarbeiten lohnt.
 *
 * Das ist der günstigste, den man sich NOCH NICHT leisten kann – nicht der
 * günstigste überhaupt. Sonst zeigte die Startseite ewig „Kaffee aufs Haus", auch
 * wenn man den längst dreimal einlösen könnte, und die Karte hätte nichts mehr zu
 * sagen. `null`, wenn alles erreichbar ist.
 */
export function nextGoal(balance: number, catalog: readonly Coupon[] = COUPONS): Coupon | null {
  const open = catalog.filter((coupon) => !canAfford(coupon, balance));
  if (open.length === 0) return null;
  return open.reduce((cheapest, coupon) => (coupon.cost < cheapest.cost ? coupon : cheapest));
}

/** Wie viele Punkte noch fehlen; 0, wenn es reicht. */
export function missingFor(coupon: Coupon, balance: number): number {
  return Math.max(0, coupon.cost - Math.max(0, balance));
}

/**
 * Wie viele eigene Events noch nötig sind, um den Coupon zu erreichen.
 *
 * Die ehrlichere Angabe als „noch 40 Punkte": Punkte kommen in dieser App aus
 * genau einer Handlung, also kann man sie auch in dieser Handlung ausdrücken.
 */
export function activitiesUntil(coupon: Coupon, balance: number): number {
  return Math.ceil(missingFor(coupon, balance) / POINTS_PER_ACTIVITY);
}
