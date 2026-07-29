import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ERROR_REACTION, TAB_KEYS, moodAt, reactionFor } from './mascot-mood.ts';

test('jeder Tab hat Gesichter, eine Geste und einen Satz', () => {
  for (const tab of TAB_KEYS) {
    const reaction = reactionFor(tab);
    assert.ok(reaction.moods.length > 0, `${tab} hat kein Gesicht`);
    assert.ok(reaction.gesture, `${tab} hat keine Geste`);
    assert.ok(reaction.line.length > 0, `${tab} hat keinen Satz`);
  }
});

test('die Hauptstimmung ist immer das erste Gesicht', () => {
  // Sonst zeigt die Figur bei abgeschalteter Bewegung ein anderes Gesicht als
  // im ersten Schritt des Wechsels.
  for (const tab of TAB_KEYS) {
    const reaction = reactionFor(tab);
    assert.equal(reaction.mood, reaction.moods[0]);
    assert.equal(reaction.mood, moodAt(tab, 0));
  }
});

test('die Tabs reagieren unterschiedlich – sonst wäre die Figur Tapete', () => {
  const moods = TAB_KEYS.map((tab) => reactionFor(tab).mood);
  // Genau der Punkt der Anforderung: „soll dem Tab entsprechen".
  assert.equal(new Set(moods).size, TAB_KEYS.length);
});

test('gewinkt wird dort, wo man jemanden begrüßt oder trifft', () => {
  assert.equal(reactionFor('home').gesture, 'wave');
  assert.equal(reactionFor('friends').gesture, 'wave');
  // Auf der Karte wird gesucht, nicht gewinkt.
  assert.equal(reactionFor('map').gesture, 'look');
  // Und wer schläft, gestikuliert nicht.
  assert.equal(reactionFor('settings').gesture, 'none');
});

test('moodAt läuft im Kreis', () => {
  assert.equal(moodAt('home', 0), 'happy');
  assert.equal(moodAt('home', 1), 'idle');
  assert.equal(moodAt('home', 2), 'happy');
  assert.equal(moodAt('home', 101), 'idle');
});

test('moodAt: ein Tab mit nur einem Gesicht wechselt nicht', () => {
  for (const step of [0, 1, 2, 7, 1000]) {
    assert.equal(moodAt('settings', step), 'asleep');
  }
});

test('moodAt verträgt jede Zahl – ein Zähler läuft beliebig weit', () => {
  assert.equal(moodAt('home', -1), 'idle');
  assert.equal(moodAt('home', -2), 'happy');
  assert.equal(moodAt('home', 1.9), 'idle');
  assert.equal(moodAt('home', Number.NaN), 'happy');
  assert.equal(moodAt('home', Number.POSITIVE_INFINITY), 'happy');
});

test('ein unbekannter Tab fällt auf die Startseite zurück statt zu werfen', () => {
  assert.deepEqual(reactionFor('gibtsnicht'), reactionFor('home'));
  assert.equal(moodAt('gibtsnicht', 1), moodAt('home', 1));
});

test('der Fehlerfall sagt „Oh oh" und erklärt es in einem Satz', () => {
  assert.equal(ERROR_REACTION.headline, 'Oh oh');
  assert.equal(ERROR_REACTION.line, 'Es ist ein Fehler aufgetreten.');
  assert.equal(ERROR_REACTION.mood, 'oops');
});
