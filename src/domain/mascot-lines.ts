/**
 * Was Goenni außerhalb der Startseite sagt – je Tab, beim Antippen, zur Saison.
 *
 * Die Startseite hat ihre eigenen Tipps (`mascot-tips.ts`). Hier liegen die Sätze
 * für den Begleiter unten rechts (src/components/mascot-dock.tsx), der auf allen
 * Tabs mitläuft, und für Antippen, Festhalten und besondere Momente.
 *
 * Regeln für neue Sätze:
 *  - **Was nützt, kommt zuerst** (ungelesene Nachrichten, ein Ticket verfällt
 *    bald), Smalltalk zuletzt.
 *  - **Kurz.** Die Blase hat drei Zeilen; ein Satz, höchstens zwei.
 *  - **Du, locker, nie belehrend.** Keine Emojis – Goenni ist selbst das Bild.
 */
import { formatCredits } from './club.ts';
import type { MascotMood } from './mascot-mood.ts';
import type { SeasonKey } from './season.ts';
import type { Tip } from './mascot-tips.ts';

export type MascotScene = 'home' | 'groups' | 'finder' | 'bookings' | 'map';

export type SceneContext = {
  firstName: string | null;
  groups: number;
  unread: number;
  openBookings: number;
  /** Die offene Buchung, die als nächste verfällt – Tage bis dahin (0 = heute). */
  nextExpiry: { title: string; days: number } | null;
  credits: number;
  stampsRemaining: number;
  rewardCredits: number;
  season: SeasonKey;
  /** 0 = Sonntag … 6 = Samstag. */
  weekday: number;
  hour: number;
};

const tip = (line: string, mood: MascotMood): Tip => ({ line, mood });

/** Ein Satz zur Saison – für Startseite und Begleiter. */
export const SEASON_LINES: Record<SeasonKey, readonly Tip[]> = {
  halloween: [tip('Buh! Hab ich dich erschreckt? Happy Halloween!', 'cheer'), tip('Kürbis-Saison! Wie gefällt dir mein Hexenhut?', 'happy')],
  advent: [tip('Ho ho ho! Steht mir die Mütze? Credits sind übrigens ein super Geschenk.', 'cheer'), tip('Advent, Advent – Zeit für was Gemeinsames mit deinen Liebsten.', 'happy')],
  newyear: [tip('Guten Rutsch! Neues Jahr, neue Stempelkarte?', 'cheer')],
  winter: [tip('Brr, kalt draußen! Wie wär’s mit was Drinnen?', 'thinking'), tip('Schneeflocken zählen ist schön – Stempel zählen ist schöner.', 'happy')],
  valentine: [tip('Valentinstag! Schon zu zweit gibt’s Gruppenrabatt.', 'happy')],
  easter: [tip('Frohe Ostern! Ich hab ein paar Angebote versteckt – such mal.', 'happy')],
  spring: [tip('Frühling! Perfekt für was draußen.', 'happy')],
  summer: [tip('Sonne pur! Zeit für Abenteuer draußen.', 'cheer')],
  autumn: [tip('Herbst – gemütlich drinnen oder bunt draußen?', 'idle')],
};

/** Ein Satz zum Wochentag – oder `null`, wenn der Tag nichts Besonderes ist. */
export function weekdayLine(weekday: number, hour: number): Tip | null {
  if (weekday === 5 && hour >= 12) return tip('Freitag! Schon Pläne fürs Wochenende?', 'cheer');
  if (weekday === 6 || weekday === 0) return tip('Wochenende! Perfekt für einen Ausflug mit der Gruppe.', 'happy');
  if (weekday === 1 && hour < 14) return tip('Neue Woche, neue Abenteuer – was steht an?', 'idle');
  return null;
}

/** Smalltalk: kommt zwischendurch, wenn es nichts Wichtigeres gibt. */
export const SMALL_TALK: readonly Tip[] = [
  tip('Ich kann übrigens Salto. Tipp mich an!', 'happy'),
  tip('Meine Antenne empfängt gerade … ein Abenteuer!', 'thinking'),
  tip('Mit Freunden macht alles mehr Spaß – und kostet weniger.', 'happy'),
  tip('Göttingen hat so viel zu bieten. Lass uns was erleben!', 'cheer'),
  tip('Psst: Halt mich gedrückt, dann mach ich kurz Pause.', 'idle'),
  tip('Ich hab heute schon dreimal meine Stempel gezählt.', 'happy'),
];

/** Wann ein Ticket abläuft, in Worten. */
export function expiryWords(days: number): string {
  if (days <= 0) return 'heute';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
}

function sceneSpecific(scene: MascotScene, ctx: SceneContext): Tip[] {
  switch (scene) {
    case 'home':
      return [
        ...(ctx.stampsRemaining === 1 ? [tip(`Nur noch EIN Stempel bis ${ctx.rewardCredits} Credits!`, 'cheer')] : []),
        ...(ctx.credits > 0 ? [tip(`Du hast ${formatCredits(ctx.credits)} Credits – damit bezahlst du bei allen Partnern.`, 'happy')] : []),
        tip('Scroll ruhig weiter – ich pass hier unten auf.', 'happy'),
        tip('Unten in der Leiste: Gruppen, Entdecken und deine Tickets.', 'idle'),
      ];
    case 'finder':
      return [
        tip('Sag mir, wie viele ihr seid – ich rechne euren Gruppenpreis aus.', 'thinking'),
        tip('Je mehr ihr seid, desto günstiger wird es für jeden.', 'happy'),
        ...(ctx.groups > 0 ? [tip('Tipp: Wähl eine Gruppe, dann zähle ich für dich mit.', 'idle')] : []),
        tip('Oben einfach lostippen: „Bowling", „Escape" …', 'happy'),
        tip('Nichts dabei? Nimm einen Filter raus – ich suche weiter.', 'thinking'),
      ];
    case 'groups':
      return [
        ...(ctx.unread > 0
          ? [tip(ctx.unread === 1 ? 'Im Gruppenchat wartet eine neue Nachricht!' : `Im Gruppenchat warten ${ctx.unread} neue Nachrichten!`, 'cheer')]
          : []),
        ctx.groups === 0
          ? tip('Leg eine Gruppe an und teil den Link – ab 2 Leuten spart ihr.', 'happy')
          : tip('Lade noch jemanden ein – mehr Leute, mehr Rabatt.', 'happy'),
        tip('Im Gruppenchat plant ihr, unter „Entdecken" sucht ihr – ich helfe bei beidem.', 'idle'),
      ];
    case 'bookings':
      return [
        ...(ctx.nextExpiry && ctx.nextExpiry.days <= 7
          ? [tip(`Achtung: „${ctx.nextExpiry.title}" verfällt ${expiryWords(ctx.nextExpiry.days)}!`, 'thinking')]
          : []),
        ctx.openBookings > 0
          ? tip('Den Code zeigst du einfach vor – oder hältst das Handy an den Aufkleber.', 'happy')
          : tip('Noch nichts gebucht? Unter „Entdecken" hab ich Ideen für dich!', 'thinking'),
        tip('Jedes Ticket hat ein Ablaufdatum – das steht groß auf der Karte.', 'idle'),
      ];
    case 'map':
      return [
        tip('Tipp auf einen Pin, dann zeig ich dir, was es dort gibt.', 'happy'),
        tip('Bei jedem Besuch gibt es einen Stempel. Ich zähle mit!', 'happy'),
        tip('Alle Partner auf einen Blick – such dir einen in der Nähe aus.', 'idle'),
      ];
  }
}

/**
 * Alles, was Goenni auf einem Tab sagt – Wichtiges zuerst, dann Saison und
 * Wochentag, zum Schluss ein Satz Smalltalk (wechselt mit der Stunde).
 */
export function sceneLines(scene: MascotScene, ctx: SceneContext): Tip[] {
  const lines = sceneSpecific(scene, ctx);
  const season = SEASON_LINES[ctx.season];
  if (season.length > 0) lines.push(season[ctx.hour % season.length]);
  const day = weekdayLine(ctx.weekday, ctx.hour);
  if (day) lines.push(day);
  lines.push(SMALL_TALK[(ctx.hour + ctx.weekday) % SMALL_TALK.length]);
  return lines;
}

/** Was Goenni beim n-ten Antippen sagt – wird mit der Zeit frecher. */
const POKE_LINES: readonly Tip[] = [
  tip('Hihi, das kitzelt!', 'cheer'),
  tip('Noch mal? Okay – Salto!', 'cheer'),
  tip('Ich bin Goenni, dein Spar-Buddy.', 'happy'),
  tip('Du tippst ja schneller, als ich hüpfen kann!', 'happy'),
  tip('Hui, mir wird ganz schwindelig …', 'thinking'),
  tip('Okay, okay, ich bin wach!', 'cheer'),
  tip('Weißt du was? 10 Stempel = 100 Credits.', 'happy'),
  tip('Stups mich ruhig, ich bin aus Gummi.', 'happy'),
  tip('Wenn du mich so magst – lad doch Freunde ein!', 'happy'),
];

/** `count` = wie oft schon getippt (1 = erstes Mal). Jedes zehnte Mal ein Rekord. */
export function pokeLine(count: number): Tip {
  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  if (n % 10 === 0) return tip(`Rekord! Du hast mich ${n}-mal gestupst.`, 'cheer');
  return POKE_LINES[(n - 1) % POKE_LINES.length];
}

/** Festhalten: Goenni duckt sich weg – und kommt auf Antippen zurück. */
export const DUCK_LINE: Tip = tip('Okay, ich mach kurz Pause. Tipp auf meine Antenne, wenn du mich brauchst!', 'happy');
export const BACK_LINE: Tip = tip('Da bin ich wieder!', 'cheer');

/** Nach einem Credit-Kauf. `until` ist das fertige Datum („05.10.2027"). */
export function purchaseLine(added: number, until: string | null): Tip {
  const amount = formatCredits(added);
  return tip(until ? `Wuhu, ${amount} Credits! Die gelten bis ${until}.` : `Wuhu, ${amount} Credits!`, 'cheer');
}
