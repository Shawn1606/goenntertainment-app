import test from 'node:test';
import assert from 'node:assert/strict';

import { BACK_LINE, DUCK_LINE, FLIGHT_LINES, SEASON_LINES, SMALL_TALK, expiryWords, flightLine, pokeLine, purchaseLine, sceneLines, weekdayLine, type SceneContext } from './mascot-lines.ts';
import { homeTips } from './mascot-tips.ts';

const base: SceneContext = {
  firstName: 'Lena',
  groups: 0,
  unread: 0,
  openBookings: 0,
  nextExpiry: null,
  credits: 0,
  stampsRemaining: 10,
  rewardCredits: 100,
  season: 'halloween',
  weekday: 3,
  hour: 15,
};

/** Emojis haben in Goennis Sätzen nichts zu suchen – er ist selbst das Bild. */
const EMOJI = /\p{Extended_Pictographic}/u;

test('ungelesene Nachrichten kommen in den Gruppen zuerst', () => {
  assert.match(sceneLines('groups', { ...base, unread: 3 })[0].line, /3 neue Nachrichten/);
  assert.match(sceneLines('groups', { ...base, unread: 1 })[0].line, /eine neue Nachricht/);
});

test('ein bald ablaufendes Ticket wird zuerst angesagt', () => {
  const lines = sceneLines('bookings', { ...base, openBookings: 1, nextExpiry: { title: 'Bowling', days: 2 } });
  assert.match(lines[0].line, /Bowling" verfällt in 2 Tagen/);
  assert.ok(!sceneLines('bookings', { ...base, openBookings: 1, nextExpiry: { title: 'Bowling', days: 30 } })[0].line.includes('verfällt'));
});

test('jeder Tab hat Sätze, dazu Saison und Smalltalk', () => {
  for (const scene of ['home', 'groups', 'finder', 'bookings', 'map'] as const) {
    const lines = sceneLines(scene, base);
    assert.ok(lines.length >= 3, scene);
    assert.ok(lines.some((t) => SEASON_LINES.halloween.includes(t)), `${scene} ohne Saison`);
    assert.ok(lines.some((t) => SMALL_TALK.includes(t)), `${scene} ohne Smalltalk`);
  }
});

test('Wochentage: Freitag, Wochenende, Montag – sonst nichts', () => {
  assert.match(weekdayLine(5, 16)?.line ?? '', /Freitag/);
  assert.match(weekdayLine(6, 10)?.line ?? '', /Wochenende/);
  assert.match(weekdayLine(1, 9)?.line ?? '', /Neue Woche/);
  assert.equal(weekdayLine(3, 12), null);
});

test('Antippen: erst kitzeln, jedes zehnte Mal ein Rekord', () => {
  assert.equal(pokeLine(1).line, 'Hihi, das kitzelt!');
  assert.match(pokeLine(10).line, /Rekord! Du hast mich 10-mal gestupst/);
  assert.match(pokeLine(20).line, /20-mal/);
  assert.ok(pokeLine(0).line.length > 0);
  assert.ok(pokeLine(Number.NaN).line.length > 0);
});

test('Kauf-Satz nennt Menge und Gültigkeit', () => {
  assert.equal(purchaseLine(1250, '05.10.2027').line, 'Wuhu, 1.250 Credits! Die gelten bis 05.10.2027.');
  assert.equal(purchaseLine(50, null).line, 'Wuhu, 50 Credits!');
});

test('Ablauf in Worten', () => {
  assert.equal(expiryWords(0), 'heute');
  assert.equal(expiryWords(1), 'morgen');
  assert.equal(expiryWords(5), 'in 5 Tagen');
});

test('Startseite: Saison-Satz vor der Begrüßung, die bleibt zuletzt', () => {
  const tips = homeTips({
    firstName: 'Lena',
    hour: 8,
    stampsRemaining: 10,
    stampsFilled: 0,
    rewardCredits: 100,
    credits: 0,
    plan: 'free',
    openBookings: 0,
    groups: 0,
    season: 'advent',
    weekday: 5,
  });
  assert.ok(tips.some((t) => SEASON_LINES.advent.includes(t)));
  assert.equal(tips.at(-1)?.line, 'Guten Morgen, Lena!');
});

test('keine Emojis und keine überlangen Sätze', () => {
  const all = [
    ...Object.values(SEASON_LINES).flat(),
    ...SMALL_TALK,
    DUCK_LINE,
    BACK_LINE,
    ...FLIGHT_LINES,
    ...Array.from({ length: 12 }, (_, i) => pokeLine(i + 1)),
    ...(['home', 'groups', 'finder', 'bookings', 'map'] as const).flatMap((s) =>
      sceneLines(s, { ...base, unread: 2, groups: 1, openBookings: 1, credits: 40, stampsRemaining: 1, nextExpiry: { title: 'Kart', days: 1 } }),
    ),
  ];
  for (const t of all) {
    assert.ok(!EMOJI.test(t.line), `Emoji in „${t.line}"`);
    assert.ok(t.line.length <= 110, `zu lang: „${t.line}"`);
  }
});

test('nach dem Flug: reihum ein anderer Satz, auch bei unsinniger Zählung', () => {
  assert.equal(flightLine(1), FLIGHT_LINES[0]);
  assert.equal(flightLine(2), FLIGHT_LINES[1]);
  assert.equal(flightLine(FLIGHT_LINES.length + 1), FLIGHT_LINES[0]);
  assert.equal(flightLine(Number.NaN), FLIGHT_LINES[0]);
  assert.equal(flightLine(-3), FLIGHT_LINES[0]);
});
