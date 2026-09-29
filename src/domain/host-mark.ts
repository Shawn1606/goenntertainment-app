/**
 * Das Zeichen eines Anbieters: Kürzel und Farbe, aus dem Namen abgeleitet.
 *
 * ## Warum das nötig ist
 *
 * Ein Event ohne eigenes Bild bekam ein Ballon-Symbol – dasselbe für jedes. Bei
 * 143 Terminen aus einem Haus stand also 143-mal derselbe Ballon, und das ist
 * schlimmer als kein Bild: Ein Symbol, das überall gleich ist, sagt nichts und
 * belegt trotzdem die Fläche, auf der man ein Haus wiedererkennen würde.
 *
 * Kürzel plus Farbe machen daraus etwas Unterscheidbares, ohne dass irgendwer ein
 * Logo hochladen muss. „NB" auf Violett ist nicht das Logo des Nörgelbuff – aber
 * es ist beim zweiten Mal wiedererkennbar, und genau das ist der Zweck.
 *
 * Hat das Haus ein Bild, gewinnt das Bild; dieses Zeichen ist der Rückfall
 * (siehe `activity-card.tsx`).
 */

export type HostMark = {
  /** Ein oder zwei Buchstaben. */
  initials: string;
  /** Deckende Fläche hinter dem Kürzel. */
  background: string;
  /** Lesbare Schriftfarbe darauf. */
  foreground: string;
};

/**
 * Die Palette, aus der ein Haus seine Farbe bekommt.
 *
 * Alle bewusst mitteldunkel: Auf jeder davon ist Weiß lesbar, und damit braucht
 * es keine Helligkeitsrechnung für die Schriftfarbe. Die Töne sind über den
 * Farbkreis verteilt, damit zwei Häuser nebeneinander im Regal nicht dieselbe
 * Farbe zu haben scheinen.
 */
const PALETTE = [
  '#4f46e5', // Indigo – die Hausfarbe der App
  '#0f766e', // Petrol
  '#b45309', // Bernstein
  '#9333ea', // Violett
  '#0369a1', // Blau
  '#15803d', // Grün
  '#be123c', // Rot
  '#7c3aed', // Lila
  '#a16207', // Ocker
  '#0e7490', // Türkis
];

/**
 * Wählt die Farbe über die ID und nicht über den Namen.
 *
 * Die ID ändert sich nie. Der Name schon – und mit ihm würde ein Haus nach einer
 * Umbenennung („musa" → „musa Kulturzentrum") plötzlich in einer anderen Farbe
 * im Regal stehen, obwohl es dasselbe Haus ist.
 */
function colorFor(id: number): string {
  // Betrag, weil eine negative ID (die es nicht geben sollte) sonst einen
  // Index ausserhalb der Palette ergäbe und `undefined` zurückkäme.
  return PALETTE[Math.abs(Math.trunc(id)) % PALETTE.length];
}

/**
 * Bildet das Kürzel: Anfangsbuchstaben der ersten zwei Wörter.
 *
 * Ein einzelnes Wort gibt nur EINEN Buchstaben und nicht die ersten zwei
 * ("Nörgelbuff" → „N", nicht „NÖ"): Zwei Buchstaben aus einem Wort lesen sich wie
 * eine Abkürzung, die es nicht gibt. Bei zwei Wörtern sind es die Initialen, und
 * die sind eine echte.
 */
function initialsFor(name: string): string {
  const words = String(name ?? '')
    .trim()
    .split(/[\s–-]+/)
    .filter(Boolean);

  if (words.length === 0) return '?';

  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  return letters.join('').toLocaleUpperCase('de-DE');
}

export function hostMark(host: { id: number; name: string } | null | undefined): HostMark {
  if (!host) {
    return { initials: '?', background: PALETTE[0], foreground: '#ffffff' };
  }

  return {
    initials: initialsFor(host.name),
    background: colorFor(host.id),
    // Fest weiß: Die Palette ist so gewählt, dass Weiß auf jedem Ton lesbar ist.
    foreground: '#ffffff',
  };
}
