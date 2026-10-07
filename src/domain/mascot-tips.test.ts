import test from 'node:test';
import assert from 'node:assert/strict';

import { homeTips, tipAt, type TipContext } from './mascot-tips.ts';

const base: TipContext = {
  firstName: 'Lena',
  hour: 15,
  stampsRemaining: 10,
  stampsFilled: 0,
  rewardCredits: 100,
  credits: 0,
  plan: 'free',
  openBookings: 0,
  groups: 0,
};

test('bald verfallende Credits kommen ganz nach vorn', () => {
  const soon = homeTips({ ...base, openBookings: 1, expiringCredits: 120, expiringDays: 5 });
  assert.equal(soon[0].line, '120 Credits verfallen in 5 Tagen – lös sie ein, bevor sie weg sind!');
  assert.equal(soon[0].mood, 'oops');
  assert.match(homeTips({ ...base, expiringCredits: 50, expiringDays: 1 })[0].line, /morgen/);
  // Noch weit weg: kein Hinweis.
  assert.ok(!homeTips({ ...base, expiringCredits: 50, expiringDays: 90 }).some((t) => t.line.includes('verfallen')));
});

test('offene Buchung kommt zuerst', () => {
  const tips = homeTips({ ...base, openBookings: 1 });
  assert.match(tips[0].line, /offene Buchung/);
});

test('ein Stempel vor dem Ziel wird gefeiert', () => {
  const tips = homeTips({ ...base, stampsFilled: 9, stampsRemaining: 1 });
  assert.equal(tips[0].mood, 'cheer');
  assert.match(tips[0].line, /EIN Stempel/);
});

test('ohne Gruppe der Hinweis auf den Gruppenrabatt, mit Gruppe der Finder', () => {
  assert.ok(homeTips(base).some((t) => t.line.includes('Rabatt')));
  assert.ok(homeTips({ ...base, groups: 2 }).some((t) => t.line.includes('wer mitkommt')));
});

test('bezahlte Stufen bekommen keine Werbung für sich selbst', () => {
  assert.ok(!homeTips({ ...base, plan: 'gold' }).some((t) => t.line.includes('Gold oder Platinum')));
});

test('Begrüßung nach Tageszeit, immer als letzter Satz', () => {
  const tips = homeTips({ ...base, hour: 8 });
  assert.equal(tips.at(-1)?.line, 'Guten Morgen, Lena!');
  assert.equal(homeTips({ ...base, firstName: null, hour: 20 }).at(-1)?.line, 'Guten Abend! Was geht heute?');
});

test('tipAt läuft im Kreis', () => {
  const tips = homeTips(base);
  assert.equal(tipAt(tips, tips.length).line, tips[0].line);
  assert.equal(tipAt([], 3).line, 'Hi!');
});

test('jeder Tipp passt in die Blase auf der Startseite (drei Zeilen, ~80 Zeichen)', () => {
  const variants: Partial<TipContext>[] = [
    { openBookings: 1 },
    { openBookings: 3 },
    { stampsFilled: 9, stampsRemaining: 1 },
    { stampsFilled: 4, stampsRemaining: 6 },
    { groups: 2, credits: 1250 },
    { plan: 'gold' },
  ];
  for (const v of variants) {
    for (const t of homeTips({ ...base, ...v, firstName: 'Maximiliane', season: 'advent', weekday: 5, hour: 18 })) {
      assert.ok(t.line.length <= 80, `zu lang (${t.line.length}): „${t.line}“`);
    }
  }
});
