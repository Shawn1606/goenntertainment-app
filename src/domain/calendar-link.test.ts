import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CALENDAR_DEFAULT_HOURS, calendarLinkFor, calendarStamp } from './calendar-link.ts';

/** Ein vollständiges Event als Ausgangspunkt; die Tests ändern jeweils ein Feld. */
const EVENT = {
  title: 'Feierabend-Lauf am Kanal',
  description: 'Locker 5 km, niemand wird abgehängt.',
  location: 'Kanalbrücke, Münster',
  starts_at: '2026-08-14T18:30:00.000Z',
};

test('calendarStamp macht aus einer ISO-Zeit einen UTC-Stempel', () => {
  // Kalender-Adressen wollen kompaktes UTC ohne Trenner.
  assert.equal(calendarStamp(new Date('2026-08-14T18:30:00.000Z')), '20260814T183000Z');
  assert.equal(calendarStamp(new Date('2026-01-05T07:04:09.000Z')), '20260105T070409Z');
});

test('calendarStamp bleibt bei einstelligen Werten zweistellig', () => {
  assert.equal(calendarStamp(new Date('2026-03-02T01:02:03.000Z')), '20260302T010203Z');
});

test('calendarLinkFor liefert eine vollständige Google-Kalender-Adresse', () => {
  const link = calendarLinkFor(EVENT);
  assert.ok(link, 'mit Startzeit muss ein Link herauskommen');
  assert.ok(link.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&'));
  assert.match(link, /[?&]dates=20260814T183000Z%2F20260814T203000Z(&|$)/);
});

test('calendarLinkFor setzt die Standarddauer, wenn nichts anderes bekannt ist', () => {
  // Ein Event ohne Ende ist der Normalfall – die API kennt nur `starts_at`.
  const link = calendarLinkFor(EVENT);
  const dates = /[?&]dates=([^&]+)/.exec(link ?? '')?.[1] ?? '';
  const [start, end] = decodeURIComponent(dates).split('/');
  const hours = (Date.parse(toIso(end)) - Date.parse(toIso(start))) / 3_600_000;
  assert.equal(hours, CALENDAR_DEFAULT_HOURS);
});

test('calendarLinkFor überträgt Titel, Ort und Beschreibung', () => {
  const link = calendarLinkFor(EVENT) ?? '';
  const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
  assert.equal(params.get('text'), EVENT.title);
  assert.equal(params.get('location'), EVENT.location);
  assert.ok(params.get('details')?.includes(EVENT.description));
});

test('calendarLinkFor maskiert Zeichen, die eine Adresse zerreißen würden', () => {
  const link =
    calendarLinkFor({
      ...EVENT,
      title: 'Jam & Chill? 100% draußen',
      location: 'Hof #3, Ecke A/B',
      description: 'Bring was mit\nBis dann!',
    }) ?? '';

  // Nichts davon darf roh in der Adresse landen.
  const query = link.slice(link.indexOf('?') + 1);
  assert.ok(!query.includes(' '), 'Leerzeichen müssen maskiert sein');
  assert.ok(!query.includes('#'), 'ein # würde den Rest zum Fragment machen');
  assert.ok(!query.includes('\n'));

  const params = new URLSearchParams(query);
  assert.equal(params.get('text'), 'Jam & Chill? 100% draußen');
  assert.equal(params.get('location'), 'Hof #3, Ecke A/B');
});

test('calendarLinkFor kommt ohne Beschreibung und ohne Ort aus', () => {
  const link = calendarLinkFor({ ...EVENT, description: '', location: '' }) ?? '';
  const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
  assert.equal(params.get('text'), EVENT.title);
  // Leere Felder werden weggelassen statt als leerer Parameter mitgeschleppt.
  assert.equal(params.get('location'), null);
});

test('calendarLinkFor hängt den Hinweis auf die App an die Beschreibung', () => {
  // Wer den Eintrag in vier Wochen im Kalender sieht, soll wissen, woher er kommt.
  const link = calendarLinkFor(EVENT) ?? '';
  const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
  assert.match(params.get('details') ?? '', /Goenntertainment/);
});

test('calendarLinkFor gibt ohne Startzeit null zurück', () => {
  // Ohne Zeitpunkt gibt es keinen Termin – dann darf auch kein Knopf erscheinen.
  assert.equal(calendarLinkFor({ ...EVENT, starts_at: null }), null);
  assert.equal(calendarLinkFor({ ...EVENT, starts_at: '' }), null);
});

test('calendarLinkFor gibt bei kaputter Startzeit null zurück', () => {
  assert.equal(calendarLinkFor({ ...EVENT, starts_at: 'übermorgen' }), null);
  assert.equal(calendarLinkFor({ ...EVENT, starts_at: '2026-13-45T99:00:00Z' }), null);
});

test('calendarLinkFor verträgt ein Event ohne Titel', () => {
  const link = calendarLinkFor({ ...EVENT, title: '   ' }) ?? '';
  const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
  // Ein Termin ohne Namen ist im Kalender nicht wiederzufinden – also ein
  // Rückfalltext statt eines leeren Eintrags.
  assert.equal(params.get('text'), 'Goenntertainment-Event');
});

/** `20260814T203000Z` → `2026-08-14T20:30:00Z`, damit `Date.parse` es versteht. */
function toIso(stamp: string): string {
  return stamp.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    '$1-$2-$3T$4:$5:$6Z',
  );
}
