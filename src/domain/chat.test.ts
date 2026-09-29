import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MESSAGE_LENGTH,
  SAME_AUTHOR_WINDOW_MS,
  groupByDay,
  highestId,
  showsAuthor,
  validateDraft,
} from './chat.ts';

/** Eine Nachricht, wie sie aus der API kommt – nur die Felder, die hier zaehlen. */
const msg = (id: number, userId: number, iso: string, body = 'x') => ({
  id,
  body,
  created_at: iso,
  is_mine: false,
  user: { id: userId, name: `N${userId}`, username: null, avatar: null, account_type: null },
  shared: null,
});

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

/* ------------------------------------------------------------- Tagesgruppen */

test('Nachrichten werden nach Kalendertag gruppiert, Reihenfolge bleibt', () => {
  const now = new Date(2026, 6, 28, 20, 0);
  const sections = groupByDay(
    [
      msg(1, 5, at(2026, 7, 27, 10, 0), 'gestern früh'),
      msg(2, 5, at(2026, 7, 27, 18, 0), 'gestern spät'),
      msg(3, 6, at(2026, 7, 28, 9, 0), 'heute'),
    ],
    now,
  );

  assert.equal(sections.length, 2);
  assert.equal(sections[0].label, 'Gestern');
  assert.deepEqual(sections[0].messages.map((m) => m.id), [1, 2]);
  assert.equal(sections[1].label, 'Heute');
  assert.deepEqual(sections[1].messages.map((m) => m.id), [3]);
});

test('eine leere Liste ergibt keine Gruppen', () => {
  assert.deepEqual(groupByDay([], new Date()), []);
});

test('Nachrichten ohne Zeitpunkt landen in der laufenden Gruppe, statt zu verschwinden', () => {
  // Kann passieren, wenn ein Server das Feld nicht liefert. Eine Nachricht, die
  // man geschrieben hat, darf nicht deshalb aus dem Verlauf fallen.
  const now = new Date(2026, 6, 28, 20, 0);
  const sections = groupByDay(
    [msg(1, 5, at(2026, 7, 28, 9, 0)), { ...msg(2, 5, at(2026, 7, 28, 9, 1)), created_at: null }],
    now,
  );
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].messages.map((m) => m.id), [1, 2]);
});

/* ------------------------------------------------------- Folgenachrichten */

test('die erste Nachricht zeigt immer, von wem sie ist', () => {
  assert.equal(showsAuthor(msg(1, 5, at(2026, 7, 28, 9, 0)), undefined), true);
  assert.equal(showsAuthor(msg(1, 5, at(2026, 7, 28, 9, 0)), null), true);
});

test('dieselbe Person kurz danach wiederholt den Namen nicht', () => {
  const first = msg(1, 5, at(2026, 7, 28, 9, 0));
  const second = msg(2, 5, at(2026, 7, 28, 9, 1));
  assert.equal(showsAuthor(second, first), false);
});

test('nach einer Pause steht der Name wieder da', () => {
  const first = msg(1, 5, at(2026, 7, 28, 9, 0));
  const later = { ...msg(2, 5, at(2026, 7, 28, 9, 0)) };
  later.created_at = new Date(new Date(first.created_at).getTime() + SAME_AUTHOR_WINDOW_MS + 1000).toISOString();
  assert.equal(showsAuthor(later, first), true);
});

test('eine andere Person zeigt immer ihren Namen', () => {
  const mine = msg(1, 5, at(2026, 7, 28, 9, 0));
  const theirs = msg(2, 6, at(2026, 7, 28, 9, 1));
  assert.equal(showsAuthor(theirs, mine), true);
});

// Die Ungelesen-Plakette wird in `unread-badge.test.ts` geprüft – sie gehört
// nicht mehr allein den Chats.

/* ---------------------------------------------------------------- Cursor */

test('der Cursor ist die hoechste ID, nicht die letzte Zeile', () => {
  // Die Liste kommt sortiert, aber darauf soll sich der Abruf nicht verlassen:
  // Eine falsche Reihenfolge wuerde sonst Nachrichten uebergehen.
  assert.equal(highestId([msg(3, 1, at(2026, 7, 28)), msg(7, 1, at(2026, 7, 28)), msg(5, 1, at(2026, 7, 28))]), 7);
  assert.equal(highestId([]), 0);
});

/* --------------------------------------------------------------- Entwurf */

test('ein Entwurf mit Text ist sendbar', () => {
  assert.equal(validateDraft('Hallo').ok, true);
});

test('leerer Text ist nicht sendbar, aber auch kein Fehler zum Anzeigen', () => {
  // Der Sende-Knopf ist dann einfach aus – eine rote Meldung fuer „du hast noch
  // nichts geschrieben" waere Bevormundung.
  const result = validateDraft('   ');
  assert.equal(result.ok, false);
  assert.equal(result.error, null);
});

test('zu langer Text sagt, was zu tun ist', () => {
  const result = validateDraft('a'.repeat(MAX_MESSAGE_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.length > 0);
});

test('die Laengengrenze ist dieselbe wie im Backend', () => {
  // server/src/messaging.js: MAX_MESSAGE_LENGTH = 1000. Laufen die auseinander,
  // schneidet die App etwas ab, das der Server annehmen wuerde – oder sie laesst
  // etwas zu, das er ablehnt.
  assert.equal(MAX_MESSAGE_LENGTH, 1000);
});
