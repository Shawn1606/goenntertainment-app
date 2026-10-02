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
// The sign-out functions (F-44) through the namespace: this file still loads where they are
// missing, and their tests then fail on an assertion.
import * as history from './search-history.ts';

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

/* ------------------------------------------------------- sign-out (F-44) */

/**
 * A device storage for the tests: a Map with the histories of accounts 7 and 8, the session token
 * and a key that only resembles a history. `listable` adds keys() (the web); `failing` makes
 * removing (or listing) throw.
 */
function deviceStore({ listable = false, failing = '' }: { listable?: boolean; failing?: '' | 'remove' | 'keys' } = {}) {
  const data = new Map([
    ['goenn_search_history_7', '[{"kind":"query","text":"Kicker"}]'],
    ['goenn_search_history_8', '[{"kind":"query","text":"Bowling"}]'],
    ['goenn_api_token', 'fixture-token-not-a-secret'],
    ['goenn_search_history', 'not a history key'],
  ]);
  const store: history.HistoryStore = {
    remove: async (key: string) => {
      if (failing === 'remove') throw new Error('storage unavailable');
      data.delete(key);
    },
  };
  if (listable) {
    store.keys = async () => {
      if (failing === 'keys') throw new Error('storage unavailable');
      return [...data.keys()];
    };
  }
  return { store, data };
}

const forgetting = () => {
  assert.equal(typeof history.forgetSearchHistory, 'function', 'the search history has no way to be forgotten on sign-out');
  return history.forgetSearchHistory;
};

test("signing out forgets the signed-out account's history, and only that where the storage cannot list keys", async () => {
  const forget = forgetting();
  const { store, data } = deviceStore();
  assert.deepEqual(await forget(store, 7), { removed: 1, failed: 0 });
  assert.deepEqual([...data.keys()], ['goenn_search_history_8', 'goenn_api_token', 'goenn_search_history']);
});

test('where the storage can list its keys, every history left on the device goes, the token stays', async () => {
  const forget = forgetting();
  const { store, data } = deviceStore({ listable: true });
  assert.deepEqual(await forget(store, 7), { removed: 2, failed: 0 });
  assert.deepEqual([...data.keys()], ['goenn_api_token', 'goenn_search_history']);
});

test('without a known account (session rejected at app start) only the listing helps', async () => {
  const forget = forgetting();
  const phone = deviceStore();
  assert.deepEqual(await forget(phone.store, null), { removed: 0, failed: 0 });
  assert.equal(phone.data.size, 4, 'nothing to remove without an account id on a storage that cannot list');
  const web = deviceStore({ listable: true });
  assert.deepEqual(await forget(web.store, null), { removed: 2, failed: 0 });
  assert.deepEqual([...web.data.keys()], ['goenn_api_token', 'goenn_search_history']);
});

test('a storage error never stops the sign-out', async () => {
  const forget = forgetting();
  const removing = deviceStore({ listable: true, failing: 'remove' });
  assert.deepEqual(await forget(removing.store, 7), { removed: 0, failed: 2 });
  const listing = deviceStore({ listable: true, failing: 'keys' });
  assert.deepEqual(await forget(listing.store, 7), { removed: 1, failed: 1 }, 'the own history still goes');
  assert.equal(listing.data.has('goenn_search_history_7'), false);
});

test('the history key keeps accounts apart and matches what the sign-out removes', () => {
  assert.equal(typeof history.searchHistoryKey, 'function', 'the search history has no shared key format');
  assert.equal(history.searchHistoryKey(7), 'goenn_search_history_7');
  assert.notEqual(history.searchHistoryKey(7), history.searchHistoryKey(8));
  assert.ok(history.searchHistoryKey(7).startsWith(history.SEARCH_HISTORY_KEY_PREFIX));
});
