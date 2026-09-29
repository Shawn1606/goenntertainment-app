import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hostMark } from './host-mark.ts';

test('ein Wort gibt einen Buchstaben', () => {
  assert.equal(hostMark({ id: 1, name: 'Nörgelbuff' }).initials, 'N');
});

test('zwei Wörter geben die Initialen', () => {
  assert.equal(hostMark({ id: 1, name: 'Junges Theater' }).initials, 'JT');
});

test('mehr als zwei Wörter werden nicht länger als zwei Buchstaben', () => {
  assert.equal(hostMark({ id: 1, name: 'Theater im OP' }).initials, 'TI');
});

test('Umlaute bleiben Umlaute und werden groß', () => {
  assert.equal(hostMark({ id: 1, name: 'öffentliches Kino' }).initials, 'ÖK');
});

test('Bindestriche trennen wie Leerzeichen', () => {
  assert.equal(hostMark({ id: 1, name: 'Kultur-Bahnhof' }).initials, 'KB');
});

test('die Farbe hängt an der ID, nicht am Namen', () => {
  // Ein Haus, das sich umbenennt, behält seine Farbe im Regal.
  const vorher = hostMark({ id: 42, name: 'musa' });
  const nachher = hostMark({ id: 42, name: 'musa Kulturzentrum' });
  assert.equal(vorher.background, nachher.background);
});

test('verschiedene Häuser bekommen verschiedene Farben', () => {
  const farben = [1, 2, 3, 4, 5].map((id) => hostMark({ id, name: 'X' }).background);
  assert.equal(new Set(farben).size, 5);
});

test('dieselbe ID ergibt immer dieselbe Farbe', () => {
  assert.equal(hostMark({ id: 7, name: 'A' }).background, hostMark({ id: 7, name: 'B' }).background);
});

test('kein Host ergibt ein Fragezeichen statt eines Absturzes', () => {
  assert.equal(hostMark(null).initials, '?');
  assert.equal(hostMark(undefined).initials, '?');
});

test('ein leerer Name ergibt ein Fragezeichen', () => {
  assert.equal(hostMark({ id: 1, name: '   ' }).initials, '?');
});

test('jede ID trifft eine echte Farbe – auch eine unerwartet negative', () => {
  for (const id of [0, 1, 9, 10, 1000, -3]) {
    const mark = hostMark({ id, name: 'Test' });
    assert.match(mark.background, /^#[0-9a-f]{6}$/, `ID ${id} ergab ${mark.background}`);
  }
});

test('die Schrift ist auf jeder Farbe weiß', () => {
  for (const id of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.equal(hostMark({ id, name: 'Test' }).foreground, '#ffffff');
  }
});
