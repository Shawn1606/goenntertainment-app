import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_RING_ARCS,
  STORY_HOURS,
  firstUnseenIndex,
  groupStories,
  remainingLabel,
  ringDash,
  stepStory,
  type GroupableStory,
} from './story.ts';

test('eine Story läuft nach 24 Stunden ab', () => {
  assert.equal(STORY_HOURS, 24);
});

test('unter einer Stunde zählt in Minuten', () => {
  assert.equal(remainingLabel(1), 'noch 1 Min.');
  assert.equal(remainingLabel(45), 'noch 45 Min.');
  assert.equal(remainingLabel(59), 'noch 59 Min.');
});

test('ab einer Stunde in Stunden – Singular korrekt', () => {
  assert.equal(remainingLabel(60), 'noch 1 Stunde');
  assert.equal(remainingLabel(119), 'noch 1 Stunde');
  assert.equal(remainingLabel(120), 'noch 2 Stunden');
  assert.equal(remainingLabel(23 * 60), 'noch 23 Stunden');
});

test('abgelaufen oder unbekannt heißt: gar keine Angabe', () => {
  // „noch 0 Min." wäre die Sorte Angabe, die eine Anzeige unglaubwürdig macht.
  assert.equal(remainingLabel(0), null);
  assert.equal(remainingLabel(-30), null);
  assert.equal(remainingLabel(null), null);
  assert.equal(remainingLabel(undefined), null);
});

test('Unsinn wirft nicht, sondern schweigt', () => {
  // Der Wert kommt vom Server – ein kaputtes Feld darf keinen Absturz auslösen.
  assert.equal(remainingLabel(Number.NaN), null);
  assert.equal(remainingLabel('viel' as unknown as number), null);
  assert.equal(remainingLabel(90.7), 'noch 1 Stunde');
});

/* ------------------------------------------------- Gruppierung pro Person */

/** Kurzform für eine Test-Story. */
function story(
  id: number,
  userId: number,
  options: { seen?: boolean; mine?: boolean; at?: string | null } = {},
): GroupableStory {
  return {
    id,
    seen: options.seen ?? false,
    is_mine: options.mine ?? false,
    created_at: options.at === undefined ? `2026-07-29T10:0${id}:00Z` : options.at,
    user: { id: userId, name: `Person ${userId}` },
  };
}

test('mehrere Storys einer Person werden zu EINEM Ring', () => {
  const groups = groupStories([story(1, 7), story(2, 7), story(3, 7)]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].user.id, 7);
  assert.deepEqual(
    groups[0].stories.map((s) => s.id),
    [1, 2, 3],
  );
});

test('die Reihenfolge der Gruppen folgt dem Server, nicht eigener Sortierung', () => {
  // Der Server schlägt ungesehene zuerst vor. Wer hier nachsortiert, hat zwei
  // Wahrheiten darüber, was "vorgeschlagen" heißt.
  const groups = groupStories([story(5, 9), story(1, 4), story(6, 9)]);

  assert.deepEqual(
    groups.map((g) => g.user.id),
    [9, 4],
  );
});

test('innerhalb einer Person: älteste zuerst – man erzählt seinen Tag vorwärts', () => {
  const groups = groupStories([
    story(3, 1, { at: '2026-07-29T18:00:00Z' }),
    story(1, 1, { at: '2026-07-29T08:00:00Z' }),
    story(2, 1, { at: '2026-07-29T12:00:00Z' }),
  ]);

  assert.deepEqual(
    groups[0].stories.map((s) => s.id),
    [1, 2, 3],
  );
});

test('ohne brauchbares Datum entscheidet die ID', () => {
  const groups = groupStories([story(9, 1, { at: null }), story(4, 1, { at: null })]);

  assert.deepEqual(
    groups[0].stories.map((s) => s.id),
    [4, 9],
  );
});

test('der Ring leuchtet, solange EINE Story ungesehen ist', () => {
  const mixed = groupStories([story(1, 1, { seen: true }), story(2, 1, { seen: false })]);
  assert.equal(mixed[0].seen, false);

  const done = groupStories([story(1, 2, { seen: true }), story(2, 2, { seen: true })]);
  assert.equal(done[0].seen, true);
});

test('gruppiert wird über die Konto-ID, nicht über den Namen', () => {
  // Zwei Konten dürfen gleich heißen – der Name wäre die falsche Klammer.
  const a = story(1, 1);
  const b = story(2, 2);
  b.user = { id: 2, name: a.user.name };

  assert.equal(groupStories([a, b]).length, 2);
});

test('eine Story ohne Konto wird übersprungen statt zur namenlosen Gruppe', () => {
  const broken = story(1, 1);
  broken.user = undefined as unknown as GroupableStory['user'];

  assert.deepEqual(groupStories([broken, story(2, 3)]).map((g) => g.user.id), [3]);
});

test('leere Liste ergibt keine Gruppen', () => {
  assert.deepEqual(groupStories([]), []);
});

/* ----------------------------------------------------- Einstieg und Blättern */

test('der Betrachter startet bei der ersten ungesehenen Story', () => {
  const [group] = groupStories([
    story(1, 1, { seen: true }),
    story(2, 1, { seen: true }),
    story(3, 1, { seen: false }),
  ]);

  assert.equal(firstUnseenIndex(group), 2);
});

test('ist alles gesehen, fängt es wieder vorne an', () => {
  const [group] = groupStories([story(1, 1, { seen: true }), story(2, 1, { seen: true })]);

  assert.equal(firstUnseenIndex(group), 0);
});

test('weiter blättert erst durch die Person, dann zur nächsten', () => {
  const groups = groupStories([story(1, 1), story(2, 1), story(3, 2)]);

  // Genau das war der Fehler vorher: Der zweite Tipp sprang zur nächsten Person,
  // statt das zweite eigene Bild zu zeigen.
  assert.deepEqual(stepStory(groups, { group: 0, story: 0 }, 1), { group: 0, story: 1 });
  assert.deepEqual(stepStory(groups, { group: 0, story: 1 }, 1), { group: 1, story: 0 });
});

test('am Ende der letzten Person ist Schluss', () => {
  const groups = groupStories([story(1, 1), story(2, 2)]);

  assert.equal(stepStory(groups, { group: 1, story: 0 }, 1), null);
});

test('zurück geht über die Gruppengrenze auf das LETZTE Bild davor', () => {
  const groups = groupStories([story(1, 1), story(2, 1), story(3, 2)]);

  assert.deepEqual(stepStory(groups, { group: 1, story: 0 }, -1), { group: 0, story: 1 });
});

test('vor der allerersten Story bleibt der Betrachter stehen – Zurück beendet nie', () => {
  const groups = groupStories([story(1, 1), story(2, 2)]);

  assert.deepEqual(stepStory(groups, { group: 0, story: 0 }, -1), { group: 0, story: 0 });
});

test('leere Gruppen werden übersprungen statt darauf stehen zu bleiben', () => {
  // Kann entstehen, wenn die letzte Story einer Person während des Ansehens
  // gelöscht wird.
  const groups = [
    { stories: [story(1, 1)] },
    { stories: [] as GroupableStory[] },
    { stories: [story(3, 3)] },
  ];

  assert.deepEqual(stepStory(groups, { group: 0, story: 0 }, 1), { group: 2, story: 0 });
  assert.deepEqual(stepStory(groups, { group: 2, story: 0 }, -1), { group: 0, story: 0 });
});

test('eine Position außerhalb der Liste beendet, statt zu werfen', () => {
  assert.equal(stepStory([], { group: 0, story: 0 }, 1), null);
});

/* ------------------------------------------------------------------- Der Ring */

test('eine einzelne Story ergibt einen durchgezogenen Ring', () => {
  // Ein Muster aus einem Bogen wäre eine Lücke ohne Aussage.
  assert.equal(ringDash(300, 1, 6), null);
});

test('mehrere Storys teilen den Ring in gleich große Bögen', () => {
  const dash = ringDash(300, 3, 6);

  assert.ok(dash);
  assert.deepEqual(dash, { arc: 94, gap: 6 });
  // Ein Bogen plus seine Lücke muss den Umfang genau füllen – sonst wandert das
  // Muster und der letzte Bogen sitzt schief.
  assert.equal((dash.arc + dash.gap) * 3, 300);
});

test('bei vielen Storys schrumpft die Lücke, nicht der Bogen', () => {
  // Mit fester Lücke von 6 bliebe hier ein Bogen von 6 – aus dem Ring würde eine
  // Perlenkette. Ein Bogen bleibt deshalb mindestens doppelt so lang wie seine Lücke.
  const dash = ringDash(120, 10, 6);

  assert.ok(dash);
  assert.equal(dash.gap, 4);
  assert.equal(dash.arc, 8);
});

test('mehr Storys als Bögen: gedeckelt statt gepunktet', () => {
  const many = ringDash(300, 40, 6);
  const capped = ringDash(300, MAX_RING_ARCS, 6);

  assert.deepEqual(many, capped);
});

test('Unsinn ergibt einen durchgezogenen Ring statt eines Absturzes', () => {
  // Die Zahl kommt aus einer Serverliste – ein kaputter Wert darf keine
  // Division durch Null in die Zeichenfläche schreiben.
  assert.equal(ringDash(300, 0, 6), null);
  assert.equal(ringDash(300, -3, 6), null);
  assert.equal(ringDash(300, Number.NaN, 6), null);
  assert.equal(ringDash(0, 3, 6), null);
  assert.equal(ringDash(Number.NaN, 3, 6), null);
});

test('ohne Lücke bleibt der Ring durchgezogen – nur ohne Muster gerechnet', () => {
  assert.deepEqual(ringDash(300, 2, 0), { arc: 150, gap: 0 });
});
