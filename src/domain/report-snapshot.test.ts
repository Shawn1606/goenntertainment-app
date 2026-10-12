import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeSnapshot, personLabel } from './report-snapshot.ts';

test('eine Person mit und ohne Benutzername – und ein gelöschtes Konto', () => {
  assert.equal(personLabel({ id: 7, username: 'lena_k', name: 'Lena' }), 'Lena (@lena_k)');
  assert.equal(personLabel({ id: 7, username: null, name: 'Lena' }), 'Lena');
  assert.equal(personLabel(null), 'gelöschtes Konto');
});

test('eine Nachricht: Text als Zitat, darunter wer, wo und wann', () => {
  const shown = describeSnapshot('message', {
    text: 'Hallo zusammen',
    shared_title: null,
    author: { id: 3, username: 'max_m', name: 'Max' },
    group: { id: 9, name: 'Bowling-Crew' },
    created_at: '2026-10-08T12:00:00Z',
  });
  assert.ok(shown);
  assert.equal(shown.quote, 'Hallo zusammen');
  assert.deepEqual(shown.details.slice(0, 2), ['von Max (@max_m)', 'in der Gruppe „Bowling-Crew"']);
  assert.match(shown.details[2], /^geschrieben 08\.10\.2026/);
});

test('eine Nachricht ohne Text zeigt das geteilte Angebot', () => {
  const shown = describeSnapshot('message', { text: '', shared_title: 'Lasertag', author: null });
  assert.equal(shown?.quote, 'Geteiltes Angebot: Lasertag');
  assert.deepEqual(shown?.details, ['von gelöschtes Konto']);
});

test('Gruppe, Konto, Partner und Angebot', () => {
  assert.deepEqual(describeSnapshot('group', { name: 'Crew', description: 'Wir bowlen', owner: { id: 1, username: null, name: 'Ali' } }), {
    quote: 'Crew',
    details: ['Beschreibung: „Wir bowlen"', 'angelegt von Ali'],
  });
  assert.deepEqual(describeSnapshot('user', { user: { id: 2, username: 'kim', name: 'Kim' } }), { quote: 'Kim (@kim)', details: [] });
  assert.deepEqual(describeSnapshot('partner', { name: 'Kletterhalle' }), { quote: 'Kletterhalle', details: [] });
  assert.deepEqual(describeSnapshot('offer', { title: '2 Std. Bouldern', partner_name: 'Kletterhalle' }), {
    quote: '2 Std. Bouldern',
    details: ['bei Kletterhalle'],
  });
});

test('ohne Schnappschuss (ältere Meldung) oder bei unbekannter Art: nichts', () => {
  assert.equal(describeSnapshot('message', null), null);
  assert.equal(describeSnapshot('etwas', { name: 'x' }), null);
});
