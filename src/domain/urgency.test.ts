import test from 'node:test';
import assert from 'node:assert/strict';

import { SCARCE_SEATS, urgencyFor, type UrgencyInput } from './urgency.ts';

const NOW = new Date(2026, 6, 27, 18, 0, 0); // 27.07.2026, 18:00 Uhr lokal

/** Aktivitaet, die in `minutes` Minuten startet (negativ = hat begonnen). */
function inMinutes(minutes: number, over: Partial<UrgencyInput> = {}): UrgencyInput {
  return {
    starts_at: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
    max_participants: null,
    participants_count: 0,
    ...over,
  };
}

test('ein Event, das gerade begonnen hat, laeuft', () => {
  const u = urgencyFor(inMinutes(-30), NOW);
  assert.equal(u.tone, 'live');
  assert.equal(u.label, 'Läuft jetzt');
  assert.equal(u.glow, true);
});

test('genau jetzt startend zaehlt schon als laufend', () => {
  assert.equal(urgencyFor(inMinutes(0), NOW).tone, 'live');
});

test('lange vorbei ist nicht mehr "laeuft"', () => {
  const u = urgencyFor(inMinutes(-4 * 60), NOW);
  assert.equal(u.tone, 'past');
  assert.equal(u.label, 'Vorbei');
  assert.equal(u.glow, false, 'Vergangenes soll nicht die Aufmerksamkeit ziehen');
});

test('bald startende Events zeigen die Restzeit und leuchten', () => {
  const u = urgencyFor(inMinutes(40), NOW);
  assert.equal(u.tone, 'soon');
  assert.equal(u.label, 'in 40 Min');
  assert.equal(u.glow, true);
});

test('Minuten werden bis 60 als Minuten gezeigt', () => {
  assert.equal(urgencyFor(inMinutes(5), NOW).label, 'in 5 Min');
  assert.equal(urgencyFor(inMinutes(59), NOW).label, 'in 59 Min');
});

test('ab einer Stunde in Stunden, halbe Stunden inklusive', () => {
  assert.equal(urgencyFor(inMinutes(60), NOW).label, 'in 1 Std');
  assert.equal(urgencyFor(inMinutes(150), NOW).label, 'in 2,5 Std');
  assert.equal(urgencyFor(inMinutes(120), NOW).label, 'in 2 Std');
});

test('spaeter am selben Tag: ruhiges Heute-Abzeichen mit Uhrzeit', () => {
  // 18:00 + 4 h = 22:00, also heute, aber ausserhalb des "gleich"-Fensters.
  const u = urgencyFor(inMinutes(4 * 60), NOW);
  assert.equal(u.tone, 'today');
  assert.equal(u.label, 'Heute, 22:00');
  assert.equal(u.glow, false, 'heute Abend ist noch kein Notfall');
});

test('morgen wird als morgen benannt', () => {
  const u = urgencyFor(
    { starts_at: new Date(2026, 6, 28, 10, 30).toISOString(), max_participants: null, participants_count: 0 },
    NOW,
  );
  assert.equal(u.tone, 'tomorrow');
  assert.equal(u.label, 'Morgen, 10:30');
});

test('weit in der Zukunft gibt es kein Zeit-Abzeichen', () => {
  const u = urgencyFor(
    { starts_at: new Date(2026, 7, 15, 10, 0).toISOString(), max_participants: null, participants_count: 0 },
    NOW,
  );
  assert.equal(u.tone, 'none');
  assert.equal(u.label, null);
});

test('ohne Datum bleibt die Zeit offen, die Plaetze stimmen trotzdem', () => {
  const u = urgencyFor({ starts_at: null, max_participants: 4, participants_count: 3 }, NOW);
  assert.equal(u.tone, 'none');
  assert.equal(u.label, null);
  assert.equal(u.seatsFree, 1);
  assert.equal(u.scarce, true);
});

test('ein kaputtes Datum wirft nicht, sondern schweigt', () => {
  const u = urgencyFor({ starts_at: 'morgen irgendwann', max_participants: null, participants_count: 0 }, NOW);
  assert.equal(u.tone, 'none');
  assert.equal(u.label, null);
});

test('ohne Obergrenze gibt es keine Platz-Meldung', () => {
  const u = urgencyFor(inMinutes(600, { max_participants: null, participants_count: 99 }), NOW);
  assert.equal(u.seatsFree, null);
  assert.equal(u.full, false);
  assert.equal(u.scarce, false);
  assert.equal(u.seatsLabel, null);
});

test('viele freie Plaetze sind keine Meldung wert', () => {
  const u = urgencyFor(inMinutes(600, { max_participants: 20, participants_count: 2 }), NOW);
  assert.equal(u.seatsFree, 18);
  assert.equal(u.seatsLabel, null);
  assert.equal(u.scarce, false);
});

test('knappe Plaetze werden benannt – im Singular korrekt', () => {
  const one = urgencyFor(inMinutes(600, { max_participants: 5, participants_count: 4 }), NOW);
  assert.equal(one.seatsLabel, 'Nur 1 Platz frei');
  assert.equal(one.scarce, true);

  const two = urgencyFor(inMinutes(600, { max_participants: 5, participants_count: 3 }), NOW);
  assert.equal(two.seatsLabel, 'Nur 2 Plätze frei');
});

test('genau an der Knappheitsgrenze gilt es noch als knapp', () => {
  const u = urgencyFor(
    inMinutes(600, { max_participants: 10, participants_count: 10 - SCARCE_SEATS }),
    NOW,
  );
  assert.equal(u.seatsFree, SCARCE_SEATS);
  assert.equal(u.scarce, true);
});

test('voll ist voll und nicht knapp', () => {
  const u = urgencyFor(inMinutes(600, { max_participants: 5, participants_count: 5 }), NOW);
  assert.equal(u.full, true);
  assert.equal(u.scarce, false);
  assert.equal(u.seatsLabel, 'Voll');
});

test('mehr Teilnehmer als Plaetze ergibt keine negativen freien Plaetze', () => {
  const u = urgencyFor(inMinutes(600, { max_participants: 5, participants_count: 9 }), NOW);
  assert.equal(u.seatsFree, 0);
  assert.equal(u.full, true);
});

test('knappe Plaetze duerfen auch ohne Zeitdruck leuchten', () => {
  // Weit weg (naechster Monat), damit die Zeit nichts beitraegt.
  const u = urgencyFor(
    { starts_at: new Date(2026, 7, 20, 19, 0).toISOString(), max_participants: 5, participants_count: 4 },
    NOW,
  );
  assert.equal(u.tone, 'none');
  assert.equal(u.glow, true, 'die letzten Plaetze sind selbst schon ein Grund');
});

test('ein vergangenes Event leuchtet auch mit knappen Plaetzen nicht', () => {
  const u = urgencyFor(inMinutes(-5 * 60, { max_participants: 5, participants_count: 4 }), NOW);
  assert.equal(u.tone, 'past');
  assert.equal(u.glow, false);
});
