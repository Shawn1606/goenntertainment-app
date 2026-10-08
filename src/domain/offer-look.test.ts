import test from 'node:test';
import assert from 'node:assert/strict';

import { coverPalette, formatDuration, offerFacts } from './offer-look.ts';

const base = { duration_minutes: null, min_people: 1, max_people: null, min_age: null, max_age: null, indoor: null };

test('jede Kategorie hat immer dasselbe Farbpaar – und es gibt mehrere', () => {
  assert.deepEqual(coverPalette('Bowling'), coverPalette('bowling '));
  const seen = new Set(['Bowling', 'Escape', 'Klettern', 'Kino', 'Essen & Trinken', 'Party & Club', 'Spieleabend', 'Sport'].map((n) => coverPalette(n).join()));
  assert.ok(seen.size >= 4);
  assert.equal(coverPalette(null).length, 2);
});

test('Dauer kurz und auf halbe Stunden gerundet', () => {
  assert.equal(formatDuration(45), '45 Min.');
  assert.equal(formatDuration(60), '1 Std.');
  assert.equal(formatDuration(150), '2,5 Std.');
  assert.equal(formatDuration(0), null);
  assert.equal(formatDuration(null), null);
});

test('Merkmale immer in derselben Reihenfolge: Dauer, Personen, Alter, drinnen/draußen', () => {
  const facts = offerFacts({ ...base, duration_minutes: 120, min_people: 2, max_people: 8, min_age: 6, indoor: true });
  assert.deepEqual(
    facts.map((f) => f.text),
    ['2 Std.', '2–8 Pers.', 'ab 6 J.', 'Drinnen'],
  );
  assert.deepEqual(offerFacts({ ...base, max_people: 20, indoor: false }).map((f) => f.text), ['bis 20 Pers.', 'Draußen']);
  assert.deepEqual(offerFacts({ ...base, min_people: 4 }).map((f) => f.text), ['ab 4 Pers.']);
  assert.deepEqual(offerFacts(base), []);
});
