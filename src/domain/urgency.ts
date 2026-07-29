/**
 * Dringlichkeit einer Aktivität – reine Rechenlogik, keine Anzeige.
 *
 * Warum das eigene Modul? Weil „wann ist das?" und „passe ich noch rein?" die
 * zwei Fragen sind, die vor dem Antippen einer Karte im Kopf stehen. Bisher
 * stand dort nur „27.07.2026, 19:30" – korrekt, aber man muss rechnen. „In 40
 * Min · nur noch 2 Plätze" beantwortet dieselbe Frage, ohne dass jemand rechnet,
 * und ist genau der Grund, aus dem Leute eine Event-App zweimal am Tag öffnen.
 *
 * Bewusst zurückhaltend gebaut: Es gibt genau vier Stufen, und nur zwei davon
 * dürfen leuchten. Wenn jede Karte dringend ist, ist keine dringend.
 */
import { clockTime, dayKey, shiftDay } from './day.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Ab wann ein Event als „gleich" gilt (davor: „heute" bzw. Datum). */
export const SOON_MS = 3 * HOUR;

/**
 * Wie lange nach dem Start ein Event als „läuft" gilt.
 *
 * Die Dauer steht nirgends in den Daten, also nehmen wir eine ehrliche Annahme:
 * Drei Stunden decken das typische Treffen ab. Danach ist es „vorbei", und das
 * ist die schonendere Aussage – ein Event als „läuft" zu zeigen, das seit
 * Stunden zu Ende ist, wäre eine Falschmeldung.
 */
export const LIVE_MS = 3 * HOUR;

/** Ab wie vielen freien Plätzen es „knapp" wird. */
export const SCARCE_SEATS = 3;

export type UrgencyTone =
  /** Läuft in diesem Moment. Leuchtet. */
  | 'live'
  /** Startet in den nächsten Stunden. Leuchtet. */
  | 'soon'
  /** Heute, aber noch nicht gleich. Ruhig. */
  | 'today'
  /** Morgen. Ruhig. */
  | 'tomorrow'
  /** Start liegt (nach unserer Annahme) hinter uns. */
  | 'past'
  /** Irgendwann später – kein eigenes Signal nötig. */
  | 'none';

export type Urgency = {
  tone: UrgencyTone;
  /** Kurzer Text fürs Zeit-Abzeichen; null = kein Abzeichen zeigen. */
  label: string | null;
  /** Text fürs Platz-Abzeichen; null = nichts zu melden. */
  seatsLabel: string | null;
  /** Freie Plätze; null = unbegrenzt. */
  seatsFree: number | null;
  /** Alle Plätze weg. */
  full: boolean;
  /** Wenige Plätze übrig (aber nicht voll) – das treibt Entscheidungen. */
  scarce: boolean;
  /**
   * Darf dieses Abzeichen leuchten? Nur bei echter Dringlichkeit – also wenn
   * gerade etwas läuft, gleich losgeht oder die letzten Plätze weggehen.
   */
  glow: boolean;
};

export type UrgencyInput = {
  starts_at: string | null;
  max_participants: number | null;
  participants_count: number;
};

/** „in 8 Min" · „in 40 Min" · „in 2 Std" · „in 2,5 Std". */
function untilLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `in ${minutes} Min`;

  const hours = minutes / 60;
  // Halbe Stunden mitnehmen: „in 2,5 Std" ist deutlich brauchbarer als „in 2 Std",
  // wenn tatsächlich noch 2:40 übrig sind.
  const rounded = Math.round(hours * 2) / 2;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `in ${text} Std`;
}

/** Platz-Lage aus Kapazität und Teilnehmerzahl. */
function seatsFor(input: UrgencyInput): Pick<Urgency, 'seatsLabel' | 'seatsFree' | 'full' | 'scarce'> {
  const max = input.max_participants;
  if (max === null || !Number.isFinite(max) || max <= 0) {
    return { seatsLabel: null, seatsFree: null, full: false, scarce: false };
  }

  const taken = Math.max(0, Math.floor(input.participants_count));
  const free = Math.max(0, Math.floor(max) - taken);

  if (free === 0) return { seatsLabel: 'Voll', seatsFree: 0, full: true, scarce: false };
  if (free <= SCARCE_SEATS) {
    return {
      seatsLabel: free === 1 ? 'Nur 1 Platz frei' : `Nur ${free} Plätze frei`,
      seatsFree: free,
      full: false,
      scarce: true,
    };
  }
  return { seatsLabel: null, seatsFree: free, full: false, scarce: false };
}

/**
 * Dringlichkeit einer Aktivität.
 *
 * @param now Referenz-„jetzt". Wird übergeben, damit die Regeln testbar bleiben
 *   und nicht heimlich von der Systemuhr abhängen.
 */
export function urgencyFor(input: UrgencyInput, now: Date): Urgency {
  const seats = seatsFor(input);
  const { tone, label } = timeFor(input.starts_at, now);

  /**
   * Leuchten darf genau, was jetzt eine Entscheidung verlangt: Es läuft, es geht
   * gleich los, oder die letzten Plätze gehen weg. Vergangenes nie – da ist
   * nichts mehr zu entscheiden.
   *
   * Absichtlich EINMAL abgeleitet statt in jedem Zweig von Hand gesetzt: Genau
   * daraus entstehen sonst Fälle, in denen dasselbe Ereignis je nach Zeitpunkt
   * leuchtet oder nicht, ohne dass es jemand so gemeint hätte.
   */
  const glow = tone !== 'past' && (tone === 'live' || tone === 'soon' || seats.scarce);

  return { tone, label, glow, ...seats };
}

/** Zeit-Teil der Dringlichkeit: welcher Ton und welcher Text. */
function timeFor(startsAt: string | null, now: Date): Pick<Urgency, 'tone' | 'label'> {
  const start = startsAt ? new Date(startsAt) : null;

  // Kein oder kaputtes Datum: Über die Zeit sagen wir dann nichts. Die
  // Platz-Lage stimmt trotzdem und wird weiter gemeldet.
  if (!start || Number.isNaN(start.getTime())) return { tone: 'none', label: null };

  const delta = start.getTime() - now.getTime();

  if (delta <= 0) {
    return -delta < LIVE_MS
      ? { tone: 'live', label: 'Läuft jetzt' }
      : { tone: 'past', label: 'Vorbei' };
  }

  if (delta <= SOON_MS) return { tone: 'soon', label: untilLabel(delta) };

  const today = dayKey(now);
  const startDay = dayKey(start);

  if (startDay === today) return { tone: 'today', label: `Heute, ${clockTime(start)}` };
  if (startDay === shiftDay(today, 1)) return { tone: 'tomorrow', label: `Morgen, ${clockTime(start)}` };

  return { tone: 'none', label: null };
}
