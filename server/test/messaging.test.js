/**
 * Regeln des Chats – reine Logik, ohne Datenbank.
 *
 * Hier steht bewusst NUR, was ohne Verbindung entscheidbar ist: Was darf in
 * einer Nachricht stehen, wie viele Nachrichten darf jemand pro Zeitfenster
 * senden, wie gross ist eine Seite des Verlaufs. Wer darf lesen und schreiben,
 * haengt an Mitgliedschaften und damit an der DB – das prueft
 * server/test/api.test.js gegen echte Raeume.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MESSAGE_LENGTH,
  MESSAGE_BURST,
  MESSAGE_WINDOW_MS,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  ROOM_KINDS,
  isRoomKind,
  nextBurst,
  pageLimit,
  parseMessageInput,
} from '../src/messaging.js';

/**
 * Steuerzeichen zum Testen – als Code aufgebaut und nicht als Escape in einem
 * String: Ein echtes Nullbyte in einer Quelldatei ueberlebt kein Werkzeug.
 */
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);

/* ------------------------------------------------------------ Raum-Arten */

test('es gibt genau zwei Raum-Arten und sie sind eindeutig', () => {
  assert.deepEqual(ROOM_KINDS, ['group', 'activity']);
  assert.equal(new Set(ROOM_KINDS).size, ROOM_KINDS.length);
});

test('nur bekannte Raum-Arten werden akzeptiert', () => {
  assert.equal(isRoomKind('group'), true);
  assert.equal(isRoomKind('activity'), true);
  // Der Grund fuer die Pruefung: Die Art kommt aus der URL.
  assert.equal(isRoomKind('groups'), false);
  assert.equal(isRoomKind('GROUP'), false);
  assert.equal(isRoomKind(''), false);
  assert.equal(isRoomKind(null), false);
  assert.equal(isRoomKind(undefined), false);
  assert.equal(isRoomKind(1), false);
});

/* ------------------------------------------------------------- Nachricht */

test('eine gewoehnliche Nachricht kommt sauber zurueck', () => {
  const result = parseMessageInput({ body: 'Sind wir um 18 Uhr am Kiosk?' });
  assert.equal(result.error, null);
  assert.equal(result.body, 'Sind wir um 18 Uhr am Kiosk?');
  assert.equal(result.sharedActivityId, null);
});

test('Leerraum aussen herum wird abgeschnitten', () => {
  const result = parseMessageInput({ body: '  Hallo  ' });
  assert.equal(result.error, null);
  assert.equal(result.body, 'Hallo');
});

test('eine leere Nachricht ist keine Nachricht', () => {
  assert.ok(parseMessageInput({ body: '' }).error);
  assert.ok(parseMessageInput({ body: '   ' }).error);
  assert.ok(parseMessageInput({ body: '\n\n\t' }).error);
  assert.ok(parseMessageInput({}).error);
  assert.ok(parseMessageInput(null).error);
});

test('zu lange Nachrichten werden abgelehnt', () => {
  const ok = parseMessageInput({ body: 'a'.repeat(MAX_MESSAGE_LENGTH) });
  assert.equal(ok.error, null);
  const tooLong = parseMessageInput({ body: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) });
  assert.ok(tooLong.error);
});

test('eine geteilte Aktivitaet darf ohne Text kommen', () => {
  // Genau das passiert beim Teilen: Man schickt ein Event, kein Kommentar.
  const result = parseMessageInput({ activity_id: 42 });
  assert.equal(result.error, null);
  assert.equal(result.body, '');
  assert.equal(result.sharedActivityId, 42);
});

test('Text und geteilte Aktivitaet zusammen sind erlaubt', () => {
  const result = parseMessageInput({ body: 'Das waere was fuer uns', activity_id: '7' });
  assert.equal(result.error, null);
  assert.equal(result.body, 'Das waere was fuer uns');
  assert.equal(result.sharedActivityId, 7);
});

test('eine unbrauchbare Aktivitaets-ID wird abgelehnt, nicht stillschweigend verworfen', () => {
  // Stillschweigend verwerfen hiesse: Jemand teilt ein Event und es kommt eine
  // leere Nachricht an. Ein Fehler ist die ehrlichere Antwort.
  assert.ok(parseMessageInput({ activity_id: 0 }).error);
  assert.ok(parseMessageInput({ activity_id: -3 }).error);
  assert.ok(parseMessageInput({ activity_id: 1.5 }).error);
  assert.ok(parseMessageInput({ activity_id: 'abc' }).error);
});

test('Zeilenumbrueche bleiben, Steuerzeichen nicht', () => {
  const result = parseMessageInput({ body: 'Zeile 1\nZeile 2' + NUL + BEL });
  assert.equal(result.error, null);
  assert.equal(result.body, 'Zeile 1\nZeile 2');
});

test('mehr als zwei Leerzeilen in Folge werden eingekuerzt', () => {
  // Sonst schiebt eine einzige Nachricht den ganzen Verlauf aus dem Bild.
  const result = parseMessageInput({ body: 'oben\n\n\n\n\n\nunten' });
  assert.equal(result.error, null);
  assert.equal(result.body, 'oben\n\nunten');
});

/* ---------------------------------------------------------------- Bremse */

test('die Bremse laesst einen Stoss durch und dann nicht mehr', () => {
  let stamps = [];
  for (let i = 0; i < MESSAGE_BURST; i += 1) {
    const step = nextBurst(stamps, 1000 + i);
    assert.equal(step.allowed, true, `Nachricht ${i + 1} muss durchgehen`);
    stamps = step.stamps;
  }
  const blocked = nextBurst(stamps, 1000 + MESSAGE_BURST);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  // Abgewiesene Versuche zaehlen nicht mit – sonst verlaengert sich die Sperre
  // mit jedem Klopfen an der Tuer selbst.
  assert.equal(blocked.stamps.length, MESSAGE_BURST);
});

test('nach dem Zeitfenster geht es weiter', () => {
  let stamps = [];
  for (let i = 0; i < MESSAGE_BURST; i += 1) {
    stamps = nextBurst(stamps, 1000).stamps;
  }
  assert.equal(nextBurst(stamps, 1000).allowed, false);
  const later = nextBurst(stamps, 1000 + MESSAGE_WINDOW_MS + 1);
  assert.equal(later.allowed, true);
  // Alte Zeitstempel fallen aus der Liste, sie waechst nicht unbegrenzt.
  assert.equal(later.stamps.length, 1);
});

test('die Bremse haelt auch ohne Vorgeschichte', () => {
  const step = nextBurst(undefined, 5000);
  assert.equal(step.allowed, true);
  assert.deepEqual(step.stamps, [5000]);
});

/* ------------------------------------------------------------ Seitengroesse */

test('ohne Angabe kommt die Vorgabe', () => {
  assert.equal(pageLimit(undefined), PAGE_LIMIT_DEFAULT);
  assert.equal(pageLimit(''), PAGE_LIMIT_DEFAULT);
  assert.equal(pageLimit('keine Zahl'), PAGE_LIMIT_DEFAULT);
});

test('die Seitengroesse bleibt in ihren Grenzen', () => {
  assert.equal(pageLimit('10'), 10);
  assert.equal(pageLimit('0'), 1);
  assert.equal(pageLimit('-5'), 1);
  assert.equal(pageLimit('99999'), PAGE_LIMIT_MAX);
  assert.equal(pageLimit(25.7), 25);
});
