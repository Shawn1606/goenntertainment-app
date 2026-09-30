import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addToHistory,
  MAX_HISTORY,
  MAX_SERIALIZED,
  parseHistory,
  removeFromHistory,
  serializeHistory,
  type SearchHistoryEntry,
} from './search-history.ts';

const anna: SearchHistoryEntry = { kind: 'person', id: 1, name: 'Anna', username: 'anna', avatar: null };
const bowling: SearchHistoryEntry = { kind: 'activity', id: 7, title: 'Bowling', banner_url: null };

test('Neuester Eintrag steht vorne', () => {
  const history = addToHistory(addToHistory([], anna), bowling);
  assert.deepEqual(history, [bowling, anna]);
});

test('Ein erneuter Tipp holt den Eintrag nach oben statt ihn zu verdoppeln', () => {
  const history = addToHistory([bowling, anna], anna);
  assert.deepEqual(history, [anna, bowling]);
});

test('Suchbegriffe gelten ohne Groß-/Kleinschreibung und Leerraum als gleich', () => {
  const history = addToHistory([{ kind: 'query', text: 'Fußball' }], { kind: 'query', text: '  fußball ' });
  assert.equal(history.length, 1);
  assert.deepEqual(history[0], { kind: 'query', text: 'fußball' });
});

test('Leere Suchbegriffe landen nicht im Verlauf', () => {
  assert.deepEqual(addToHistory([anna], { kind: 'query', text: '   ' }), [anna]);
});

test('Höchstens MAX_HISTORY Einträge', () => {
  let history: SearchHistoryEntry[] = [];
  for (let i = 0; i < MAX_HISTORY + 5; i++) history = addToHistory(history, { kind: 'query', text: `q${i}` });
  assert.equal(history.length, MAX_HISTORY);
  assert.deepEqual(history[0], { kind: 'query', text: `q${MAX_HISTORY + 4}` });
});

test('Entfernen nimmt genau den einen Eintrag heraus', () => {
  assert.deepEqual(removeFromHistory([bowling, anna], anna), [bowling]);
});

test('Speicherform bleibt unter der Grenze und behält die neuesten', () => {
  const long = 'x'.repeat(400);
  const history: SearchHistoryEntry[] = Array.from({ length: MAX_HISTORY }, (_, i) => ({
    kind: 'person',
    id: i,
    name: `P${i}`,
    username: null,
    avatar: `https://example.invalid/${long}`,
  }));
  const json = serializeHistory(history);
  assert.ok(json.length <= MAX_SERIALIZED);
  const back = parseHistory(json);
  assert.ok(back.length > 0);
  assert.equal(back[0].kind === 'person' && back[0].id, 0);
});

test('Kaputter oder fremder Speicherinhalt wird still verworfen', () => {
  assert.deepEqual(parseHistory('nicht json'), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
  assert.deepEqual(parseHistory(JSON.stringify([{ kind: 'query', text: 'ok' }, { kind: 'x' }, 3])), [
    { kind: 'query', text: 'ok' },
  ]);
});
