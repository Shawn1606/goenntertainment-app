/**
 * Was Goenni sagt – passend zu dem, was gerade bei dir los ist.
 *
 * Die Figur soll nicht Tapete sein, sondern mitdenken: Sie weiß, wie viele
 * Stempel noch fehlen, ob eine Buchung offen ist, ob du schon eine Gruppe hast.
 * Tippt man sie an, kommt der nächste Satz. Die Sätze stehen hier – ohne React –,
 * damit ein Test festhält, dass der wichtigste Hinweis zuerst kommt.
 *
 * Reihenfolge = Wichtigkeit: Was Geld oder Credits bringt, steht vorn; die
 * Begrüßung ist der Rückfall, wenn sonst nichts zu sagen ist.
 */
import type { MascotMood } from './mascot-mood.ts';

export type TipContext = {
  firstName: string | null;
  hour: number;
  stampsRemaining: number;
  stampsFilled: number;
  rewardCredits: number;
  credits: number;
  plan: string;
  openBookings: number;
  groups: number;
};

export type Tip = { line: string; mood: MascotMood };

function greeting(hour: number, name: string | null): string {
  const who = name ? `, ${name}` : '';
  if (hour < 5) return `Noch wach${who}?`;
  if (hour < 11) return `Guten Morgen${who}!`;
  if (hour < 17) return `Hey${who}! Schön, dass du da bist.`;
  if (hour < 22) return `Guten Abend${who}! Was geht heute?`;
  return `Späte Runde${who}?`;
}

export function homeTips(ctx: TipContext): Tip[] {
  const tips: Tip[] = [];

  if (ctx.openBookings > 0) {
    tips.push({
      line:
        ctx.openBookings === 1
          ? 'Du hast eine offene Buchung – beim Partner einfach Handy an den Aufkleber halten!'
          : `Du hast ${ctx.openBookings} offene Buchungen. Viel Spaß!`,
      mood: 'happy',
    });
  }

  if (ctx.stampsRemaining === 1) {
    tips.push({ line: `Nur noch EIN Stempel bis ${ctx.rewardCredits} Credits!`, mood: 'cheer' });
  } else if (ctx.stampsFilled > 0) {
    tips.push({ line: `Noch ${ctx.stampsRemaining} Stempel, dann gibt's ${ctx.rewardCredits} Credits geschenkt.`, mood: 'happy' });
  } else {
    tips.push({ line: `Jeder Besuch bei einem Partner = 1 Stempel. 10 Stempel = ${ctx.rewardCredits} Credits!`, mood: 'idle' });
  }

  if (ctx.groups === 0) {
    tips.push({ line: 'Mit Gruppe wird’s günstiger: Je mehr ihr seid, desto mehr Rabatt.', mood: 'happy' });
  } else {
    tips.push({ line: 'Sag mir, wer mitkommt – ich finde was, das für alle passt.', mood: 'thinking' });
  }

  if (ctx.plan === 'free') {
    tips.push({ line: 'Mit Gold oder Platinum sparst du bei jeder Buchung extra.', mood: 'idle' });
  }

  if (ctx.credits > 0) {
    tips.push({ line: `Du hast ${ctx.credits} Credits – damit kannst du bei Partnern bezahlen.`, mood: 'happy' });
  }

  tips.push({ line: greeting(ctx.hour, ctx.firstName), mood: 'happy' });
  return tips;
}

/** Der Satz im Schritt `step` – läuft im Kreis, verträgt jede Zahl. */
export function tipAt(tips: Tip[], step: number): Tip {
  if (tips.length === 0) return { line: 'Hi!', mood: 'happy' };
  const i = Math.abs(Math.floor(step)) % tips.length;
  return tips[i];
}
