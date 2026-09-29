import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstName, greetingFor, greetingLine } from './greeting.ts';
import { UI_ICON_NAMES } from './ui-icon.ts';

/** Ein Datum zu einer bestimmten Stunde (lokale Zeit – wie in der App). */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 6, 28, hour, minute);
}

test('greetingFor: jeder Tagesabschnitt bekommt seinen Gruß', () => {
  assert.equal(greetingFor(at(2)).text, 'Noch wach');
  assert.equal(greetingFor(at(8)).text, 'Guten Morgen');
  assert.equal(greetingFor(at(14)).text, 'Hallo');
  assert.equal(greetingFor(at(19)).text, 'Guten Abend');
  assert.equal(greetingFor(at(23)).text, 'Gute Nacht');
});

test('greetingFor: die Grenzen liegen genau dort, wo sie hingehören', () => {
  // An den Grenzen entstehen die Fehler – deshalb jede einzeln.
  assert.equal(greetingFor(at(4, 59)).text, 'Noch wach');
  assert.equal(greetingFor(at(5, 0)).text, 'Guten Morgen');
  assert.equal(greetingFor(at(10, 59)).text, 'Guten Morgen');
  assert.equal(greetingFor(at(11, 0)).text, 'Hallo');
  assert.equal(greetingFor(at(16, 59)).text, 'Hallo');
  assert.equal(greetingFor(at(17, 0)).text, 'Guten Abend');
  assert.equal(greetingFor(at(21, 59)).text, 'Guten Abend');
  assert.equal(greetingFor(at(22, 0)).text, 'Gute Nacht');
});

test('greetingFor: Mitternacht ist noch „Noch wach", nicht „Gute Nacht"', () => {
  assert.equal(greetingFor(at(0, 0)).text, 'Noch wach');
});

test('greetingFor: das Symbol folgt der Tageszeit', () => {
  assert.equal(greetingFor(at(2)).icon, 'moon');
  assert.equal(greetingFor(at(8)).icon, 'sunrise');
  assert.equal(greetingFor(at(14)).icon, 'sun');
  assert.equal(greetingFor(at(19)).icon, 'sunset');
  assert.equal(greetingFor(at(23)).icon, 'moon');
});

test('greetingFor: liefert nur Symbol-Namen, die das Set kennt', () => {
  const names: readonly string[] = UI_ICON_NAMES;
  for (let hour = 0; hour < 24; hour += 1) {
    const { icon } = greetingFor(at(hour));
    assert.ok(names.includes(icon), `${hour} Uhr → ${icon} fehlt im Namensraum`);
  }
});

test('greetingFor: ein kaputtes Datum wirft nicht', () => {
  assert.equal(greetingFor(new Date('völliger Unsinn')).text, 'Gute Nacht');
});

test('firstName: schneidet beim ersten Leerzeichen', () => {
  assert.equal(firstName('Mia Sommer'), 'Mia');
  assert.equal(firstName('Anna-Lena van der Berg'), 'Anna-Lena');
  assert.equal(firstName('Kim'), 'Kim');
});

test('firstName: räumt Eingaben auf, die Menschen so machen', () => {
  assert.equal(firstName('  Mia   Sommer  '), 'Mia');
  assert.equal(firstName('\tJo\tKrause'), 'Jo');
});

test('firstName: ohne brauchbaren Namen kommt null', () => {
  // null statt '' – sonst landet ein „Hallo, " in der Anzeige.
  assert.equal(firstName(''), null);
  assert.equal(firstName('   '), null);
  assert.equal(firstName(null), null);
  assert.equal(firstName(undefined), null);
  assert.equal(firstName(42 as unknown as string), null);
});

test('greetingLine: mit Namen kommt das Komma, ohne Namen nicht', () => {
  assert.equal(greetingLine(at(8), 'Mia Sommer').text, 'Guten Morgen, Mia');
  assert.equal(greetingLine(at(8), '   ').text, 'Guten Morgen');
  assert.equal(greetingLine(at(8), null).text, 'Guten Morgen');
  assert.equal(greetingLine(at(8)).text, 'Guten Morgen');
});

test('greetingLine: das Symbol bleibt das der Tageszeit', () => {
  assert.equal(greetingLine(at(19), 'Mia').icon, 'sunset');
});
