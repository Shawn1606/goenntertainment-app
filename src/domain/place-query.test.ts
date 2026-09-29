import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeQueries } from './place-query.ts';

test('der volle Text steht immer zuerst', () => {
  const queries = placeQueries('Stadtpark Köln');
  assert.equal(queries[0], 'Stadtpark Köln');
});

test('ohne Komma bleibt es bei einer Anfrage', () => {
  assert.deepEqual(placeQueries('Stadtpark Köln'), ['Stadtpark Köln']);
});

test('der Fall, der die Karte leer ließ: Name, Straße, Stadt', () => {
  // Nominatim findet den vollen Text nicht, die zweite Stufe schon.
  assert.deepEqual(placeQueries('Nörgelbuff, Gronerstraße 23, Göttingen'), [
    'Nörgelbuff, Gronerstraße 23, Göttingen',
    'Gronerstraße 23, Göttingen',
    'Nörgelbuff Göttingen',
  ]);
});

test('bei zwei Bestandteilen entsteht keine doppelte Anfrage', () => {
  // Stufe 2 ("Göttingen") und Stufe 3 ("Exil Göttingen") sind verschieden,
  // aber es darf nichts zweimal drinstehen.
  const queries = placeQueries('Exil, Göttingen');
  assert.equal(new Set(queries).size, queries.length);
  assert.deepEqual(queries, ['Exil, Göttingen', 'Göttingen', 'Exil Göttingen']);
});

test('heißt der Ort wie die Stadt, entfällt die Namens-Stufe', () => {
  const queries = placeQueries('Göttingen, Göttingen');
  assert.deepEqual(queries, ['Göttingen, Göttingen', 'Göttingen']);
});

test('leere und unbrauchbare Eingaben ergeben keine Anfrage', () => {
  assert.deepEqual(placeQueries(''), []);
  assert.deepEqual(placeQueries('   '), []);
  assert.deepEqual(placeQueries(',,,'), []);
});

test('überflüssige Zeichen werden geglättet, nicht mitgeschleppt', () => {
  assert.deepEqual(placeQueries('  Exil ,  Göttingen  '), [
    'Exil , Göttingen',
    'Göttingen',
    'Exil Göttingen',
  ]);
});

test('vier Bestandteile: Straße+Rest und Name+Stadt', () => {
  assert.deepEqual(placeQueries('musa, Hagenweg 2a, 37081, Göttingen'), [
    'musa, Hagenweg 2a, 37081, Göttingen',
    'Hagenweg 2a, 37081, Göttingen',
    'musa Göttingen',
  ]);
});
