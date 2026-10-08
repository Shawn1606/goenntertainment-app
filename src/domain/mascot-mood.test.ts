import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ERROR_REACTION, IDLE_TRICKS, MASCOT_MOODS, MASCOT_TRICKS, POKE_REACTIONS, pickTrick, pokeReaction, trickPause } from './mascot-mood.ts';

test('der Fehlerfall sagt „Oh oh" und erklärt es in einem Satz', () => {
  assert.equal(ERROR_REACTION.headline, 'Oh oh');
  assert.equal(ERROR_REACTION.line, 'Es ist ein Fehler aufgetreten.');
  assert.equal(ERROR_REACTION.mood, 'oops');
});

test('pickTrick wiederholt nie das vorige Kunststück', () => {
  for (let i = 0; i < IDLE_TRICKS.length; i++) {
    const roll = (i + 0.5) / IDLE_TRICKS.length;
    const first = pickTrick(null, roll);
    assert.notEqual(pickTrick(first, roll), first);
  }
});

test('pickTrick verträgt jede Zahl', () => {
  for (const roll of [-1, 0, 0.999, 1, 7, Number.NaN]) {
    assert.ok(IDLE_TRICKS.includes(pickTrick(null, roll)));
  }
});

test('trickPause bleibt zwischen 3,5 und 6,5 Sekunden', () => {
  assert.equal(trickPause(0), 3500);
  assert.equal(trickPause(1), 6500);
  assert.equal(trickPause(-5), 3500);
  assert.equal(trickPause(Number.NaN), 5000);
});

test('Antippen: jedes Mal ein anderes Kunststück und Gesicht, im Kreis', () => {
  for (let i = 1; i < POKE_REACTIONS.length; i++) {
    const a = pokeReaction(i);
    const b = pokeReaction(i + 1);
    assert.ok(a.trick !== b.trick || a.mood !== b.mood, `gleich bei ${i}`);
  }
  assert.deepEqual(pokeReaction(POKE_REACTIONS.length + 1), pokeReaction(1));
  assert.deepEqual(pokeReaction(Number.NaN), pokeReaction(1));
});

test('viele Gesichter und Kunststücke – und die Antipp-Reihe nutzt nur bekannte', () => {
  assert.ok(MASCOT_MOODS.length >= 13);
  assert.ok(MASCOT_TRICKS.length >= 14);
  assert.equal(new Set(MASCOT_MOODS).size, MASCOT_MOODS.length);
  for (const r of POKE_REACTIONS) {
    assert.ok(MASCOT_MOODS.includes(r.mood), r.mood);
    assert.ok(MASCOT_TRICKS.includes(r.trick), r.trick);
  }
  for (const t of IDLE_TRICKS) assert.ok(MASCOT_TRICKS.includes(t), t);
  // Die Antipp-Reihe zeigt die meisten Gesichter mindestens einmal.
  assert.ok(new Set(POKE_REACTIONS.map((r) => r.mood)).size >= 7);
});
