/**
 * Wie ein Stempel auf der Karte landet – und wie sein Stern sich bewegt.
 *
 * Echte Stempel sitzen nie ganz gerade und nie ganz mittig. Jeder Stempel
 * bekommt deshalb eine eigene Lage: bis zu 15 % seiner Größe nach links/rechts
 * und oben/unten verschoben und leicht gedreht.
 *
 * Die Lage ist zufällig, aber FEST: Sie hängt an der Nummer des Stempels
 * (`seed`), nicht an `Math.random()`. Sonst spränge jeder Stempel bei jedem
 * Neuzeichnen woandershin, und die Karte sähe beim Zurückkommen anders aus.
 *
 * Reine Zahlen, kein React – damit ein Test die Grenzen festhält.
 */

/** Größte Verschiebung als Anteil der Stempelgröße (Vorgabe: 15 % – erst 10 %, dann auf Wunsch 50 % mehr). */
export const MAX_SHIFT = 0.15;

/**
 * Stempel im Verhältnis zu seinem Feld. Über 1: Er ist größer als das Feld und
 * ragt über den gestrichelten Rand hinaus – aufgedrückt statt eingepasst
 * (Nutzerwunsch Okt. 2026; vorher 0,9, da sah es aus wie ausgefüllt).
 */
export const STAMP_SCALE = 1.2;

/** Kantenlänge eines Stempels für ein Feld der Größe `slot`, auf ganze Punkte gerundet. */
export function stampSize(slot: number): number {
  return Math.round(slot * STAMP_SCALE);
}

/**
 * Wie weit ein Stempel höchstens über sein Feld hinausragt (Punkte, eine Seite):
 * der Überstand durch die Größe plus die größte Verschiebung. Die Karte schneidet
 * ab, was über ihre Polsterung hinausgeht – dieser Wert muss darunter bleiben.
 */
export function stampReach(slot: number): number {
  const size = stampSize(slot);
  return (size - slot) / 2 + size * MAX_SHIFT;
}

/** Größte Schräglage in Grad. */
export const MAX_TILT = 14;

/** Größter Ausschlag des Sterns in der Mitte, in Grad (Vorgabe: 65°). */
export const MAX_STAR_SWING = 65;

/** Kleinster Ausschlag – darunter sähe man die Drehung kaum. */
export const MIN_STAR_SWING = 12;

/** mulberry32: kleiner, schneller Zufallsgenerator mit festem Startwert. */
export function seeded(seed: number): () => number {
  let s = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StampPose = {
  /** Verschiebung als Anteil der Größe, −0,15 … +0,15. */
  dx: number;
  dy: number;
  /** Schräglage in Grad. */
  tilt: number;
  /** Fester Versatz für die Taktgeber dieses Stempels (0 … 1). */
  phase: number;
};

/** Die feste Lage eines Stempels. `seed` = Stempel-ID (oder Feldnummer). */
export function stampPose(seed: number): StampPose {
  const next = seeded(seed * 2654435761 + 17);
  const signed = () => next() * 2 - 1;
  return {
    dx: signed() * MAX_SHIFT,
    dy: signed() * MAX_SHIFT,
    tilt: signed() * MAX_TILT,
    phase: next(),
  };
}

/**
 * Wie weit der Stern beim nächsten Mal ausschlägt: Richtung und Weite zufällig,
 * nie mehr als 65°. `amountRoll` und `directionRoll` sind Zufallszahlen in [0, 1).
 */
export function starSwing(amountRoll: number, directionRoll: number): number {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5);
  const amount = MIN_STAR_SWING + clamp(amountRoll) * (MAX_STAR_SWING - MIN_STAR_SWING);
  return clamp(directionRoll) < 0.5 ? -amount : amount;
}

/**
 * Welcher von `count` Stempeln beim Schlag `beat` der Karte dran ist (funkeln,
 * pochen): zufällig wirkend, aber fest – derselbe Schlag trifft immer denselben
 * Stempel. -1, wenn es keinen gibt.
 */
export function stampForBeat(beat: number, count: number): number {
  if (!(count > 0) || !Number.isFinite(beat)) return -1;
  return Math.floor(seeded(beat * 7919 + 13)() * Math.floor(count));
}
