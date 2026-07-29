import test from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS, badgesFor, levelFor, xpFor, type ActivityStats } from './gamification.ts';

function stats(over: Partial<ActivityStats> = {}): ActivityStats {
  return { hosted: 0, joined: 0, distinctInterests: 0, ...over };
}

test('ohne Aktivitaet gibt es 0 XP', () => {
  assert.equal(xpFor(stats()), 0);
});

test('Selbst-Organisieren bringt mehr XP als Beitreten', () => {
  assert.ok(xpFor(stats({ hosted: 1 })) > xpFor(stats({ joined: 1 })));
});

test('XP wachsen linear mit der Anzahl', () => {
  const one = xpFor(stats({ joined: 1 }));
  assert.equal(xpFor(stats({ joined: 3 })), one * 3);
});

test('Vielfalt (verschiedene Kategorien) bringt einen Bonus', () => {
  assert.ok(xpFor(stats({ joined: 2, distinctInterests: 3 })) > xpFor(stats({ joined: 2, distinctInterests: 0 })));
});

test('XP sind immer ganzzahlig und nie negativ', () => {
  const xp = xpFor(stats({ hosted: 3, joined: 7, distinctInterests: 4 }));
  assert.equal(Number.isInteger(xp), true);
  assert.ok(xp > 0);
  assert.equal(xpFor(stats({ hosted: -5, joined: -2 })), 0);
});

test('Level 1 startet bei 0 XP', () => {
  const level = levelFor(0);
  assert.equal(level.level, 1);
  assert.equal(level.title, LEVELS[0].title);
  assert.equal(level.xpIntoLevel, 0);
});

test('Level steigt mit XP und hat immer einen Titel', () => {
  const low = levelFor(0);
  const high = levelFor(5000);
  assert.ok(high.level > low.level);
  assert.ok(high.title.length > 0);
});

test('Fortschritt liegt zwischen 0 und 1', () => {
  for (const xp of [0, 30, 120, 999, 100000]) {
    const { progress } = levelFor(xp);
    assert.ok(progress >= 0 && progress <= 1, `progress ausserhalb 0..1 bei ${xp} XP: ${progress}`);
  }
});

test('das hoechste Level hat keinen naechsten Schritt mehr (progress 1)', () => {
  const top = levelFor(9_999_999);
  assert.equal(top.level, LEVELS.length);
  assert.equal(top.xpForNext, null);
  assert.equal(top.progress, 1);
});

test('genau an der Levelgrenze wird das neue Level erreicht', () => {
  const grenze = LEVELS[1].minXp;
  assert.equal(levelFor(grenze).level, 2);
  assert.equal(levelFor(grenze - 1).level, 1);
});

test('Abzeichen: ohne Aktivitaet ist keines verdient', () => {
  const badges = badgesFor(stats());
  assert.ok(badges.length > 0, 'Abzeichen werden immer alle gelistet');
  assert.equal(badges.every((b) => !b.earned), true);
});

test('Abzeichen: erstes eigenes Event schaltet den Organisator frei', () => {
  const badge = badgesFor(stats({ hosted: 1 })).find((b) => b.id === 'first-host');
  assert.equal(badge?.earned, true);
});

test('Abzeichen: erster Beitritt schaltet den Einstieg frei', () => {
  const badge = badgesFor(stats({ joined: 1 })).find((b) => b.id === 'first-join');
  assert.equal(badge?.earned, true);
});

test('Abzeichen zeigen den Fortschritt zum Ziel', () => {
  const badge = badgesFor(stats({ joined: 3 })).find((b) => b.id === 'social-5');
  assert.equal(badge?.earned, false);
  assert.equal(badge?.progress, 3);
  assert.equal(badge?.goal, 5);
});

test('Abzeichen sind bei uebererfuellten Zielen trotzdem nur einmal verdient', () => {
  const badge = badgesFor(stats({ joined: 99 })).find((b) => b.id === 'social-5');
  assert.equal(badge?.earned, true);
  assert.equal(badge?.progress, badge?.goal);
});
