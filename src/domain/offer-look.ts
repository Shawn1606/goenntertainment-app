/**
 * Wie ein Angebot auf seiner Karte aussieht – reine Logik ohne React.
 *
 * ## Ohne Foto trotzdem hochwertig
 *
 * Viele Partner haben (noch) kein Foto. Statt eines grellen Einheits-Verlaufs
 * bekommt jede Kategorie ein eigenes, ruhiges Farbpaar (`coverPalette`) – fest
 * aus dem Namen abgeleitet, damit „Bowling" immer gleich aussieht und Karten
 * nebeneinander unterscheidbar sind (NN/g: Karten sollen sich voneinander
 * abheben, nicht wiederholen).
 *
 * ## Was auf jede Karte gehört
 *
 * Baymard: Listen-Einträge brauchen die Merkmale, mit denen man entscheidet –
 * und zwar auf allen Karten dieselben, sonst werden passende Angebote
 * übersprungen. Für Aktivitäten sind das Dauer, Gruppengröße, Alter und
 * drinnen/draußen (`offerFacts`), immer in dieser Reihenfolge.
 */

/** Ruhige Farbpaare (oben links → unten rechts) – kräftig genug für weiße Schrift. */
const PALETTES: readonly (readonly [string, string])[] = [
  ['#7c3aed', '#4c1d95'], // Violett
  ['#db2777', '#831843'], // Beere
  ['#ea580c', '#9a3412'], // Kupfer
  ['#0d9488', '#134e4a'], // Petrol
  ['#2563eb', '#1e3a8a'], // Königsblau
  ['#16a34a', '#14532d'], // Tanne
  ['#c2410c', '#7c2d12'], // Ziegel
  ['#9333ea', '#3b0764'], // Pflaume
];

/** Fester Farbverlauf zu einem Schlüssel (Kategorie- oder Partnername). */
export function coverPalette(key: string | null | undefined): readonly [string, string] {
  const text = (key ?? '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

/** „90 Min.", „2 Std.", „2,5 Std." – kurz genug für eine Zeile. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0 || !Number.isFinite(minutes)) return null;
  if (minutes < 60) return `${Math.round(minutes)} Min.`;
  const hours = minutes / 60;
  const rounded = Math.round(hours * 2) / 2;
  return `${String(rounded).replace('.', ',')} Std.`;
}

type FactOffer = {
  duration_minutes: number | null;
  min_people: number;
  max_people: number | null;
  min_age: number | null;
  max_age: number | null;
  indoor: boolean | null;
};

export type OfferFact = { icon: 'clock' | 'users' | 'age' | 'home' | 'sun'; text: string };

/** Die Merkmale fürs Entscheiden, immer in derselben Reihenfolge. */
export function offerFacts(offer: FactOffer): OfferFact[] {
  const facts: OfferFact[] = [];
  const duration = formatDuration(offer.duration_minutes);
  if (duration) facts.push({ icon: 'clock', text: duration });

  if (offer.max_people !== null && offer.min_people > 1) facts.push({ icon: 'users', text: `${offer.min_people}–${offer.max_people} Pers.` });
  else if (offer.max_people !== null) facts.push({ icon: 'users', text: `bis ${offer.max_people} Pers.` });
  else if (offer.min_people > 1) facts.push({ icon: 'users', text: `ab ${offer.min_people} Pers.` });

  if (offer.min_age !== null && offer.max_age !== null) facts.push({ icon: 'age', text: `${offer.min_age}–${offer.max_age} J.` });
  else if (offer.min_age !== null && offer.min_age > 0) facts.push({ icon: 'age', text: `ab ${offer.min_age} J.` });

  if (offer.indoor === true) facts.push({ icon: 'home', text: 'Drinnen' });
  else if (offer.indoor === false) facts.push({ icon: 'sun', text: 'Draußen' });

  return facts;
}
