import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { UI_ICON_NAMES, isUiIconName, rankMedal, type UiIconName } from './ui-icon.ts';

test('UI_ICON_NAMES: keine Doppelten', () => {
  const seen = new Set<string>();
  for (const name of UI_ICON_NAMES) {
    assert.ok(!seen.has(name), `${name} steht doppelt in der Liste`);
    seen.add(name);
  }
});

test('UI_ICON_NAMES: nur kleingeschriebene Namen mit Bindestrich', () => {
  // Ein enger Namensraum ist der Punkt der Übung: Sobald hier „🏆" oder
  // „Trophy " durchkäme, wäre die Kopplung an die Darstellung zurück.
  for (const name of UI_ICON_NAMES) {
    assert.match(name, /^[a-z]+(-[a-z]+)*$/, `${name} ist kein sauberer Symbol-Name`);
  }
});

test('isUiIconName: erkennt bekannte Namen und weist alles andere ab', () => {
  assert.equal(isUiIconName('flame'), true);
  assert.equal(isUiIconName('user-check'), true);
  assert.equal(isUiIconName('gibtsnicht'), false);
  assert.equal(isUiIconName('🔥'), false);
  assert.equal(isUiIconName(null), false);
  assert.equal(isUiIconName(42), false);
});

test('rankMedal: die ersten drei Plätze bekommen ein Zeichen, danach die Zahl', () => {
  assert.deepEqual(rankMedal(1), { icon: 'medal', tone: 'gold' });
  assert.deepEqual(rankMedal(2), { icon: 'medal', tone: 'silver' });
  assert.deepEqual(rankMedal(3), { icon: 'medal', tone: 'bronze' });
  // Ab Platz 4 sagt die Zahl mehr als ein weiteres graues Abzeichen.
  assert.equal(rankMedal(4), null);
  assert.equal(rankMedal(0), null);
  assert.equal(rankMedal(-1), null);
  assert.equal(rankMedal(Number.NaN), null);
});

test('rankMedal: das gelieferte Symbol liegt im deklarierten Namensraum', () => {
  const names: readonly string[] = UI_ICON_NAMES;
  for (const rank of [1, 2, 3]) {
    const medal = rankMedal(rank);
    assert.ok(medal, `Platz ${rank} sollte ein Zeichen haben`);
    assert.ok(names.includes(medal.icon), `${medal.icon} fehlt im Namensraum`);
  }
});

/* ------------------------------------------------------------------------- *
 * Wächter über den Quellcode
 *
 * Die beiden folgenden Tests prüfen keine Rechenlogik, sondern eine
 * Vereinbarung. Sie stehen hier, weil sie genau das schützen, wofür dieses
 * Modul existiert – und weil sie ohne React und ohne Bundler laufen, also im
 * schnellen `npm test` mitkommen statt erst im Übersetzungslauf aufzufallen.
 * ------------------------------------------------------------------------- */

const SRC = join(import.meta.dirname, '..');

/** Alle `.ts`/`.tsx` unter `src/`, ohne Tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

test('icon.tsx kennt jeden deklarierten Namen', () => {
  // Absichtlich als Text geprüft statt per Import: `icon.tsx` zieht
  // react-native-svg nach, das in Node nicht lädt. `Record<UiIconName, …>`
  // dort sichert dasselbe beim Übersetzen – dieser Test sagt es nur früher
  // und mit dem fehlenden Namen im Klartext.
  const registry = readFileSync(join(SRC, 'components/ui/icon.tsx'), 'utf8');
  const missing = UI_ICON_NAMES.filter((name: UiIconName) => {
    const key = new RegExp(`(^|[\\s{,])'?${name}'?\\s*:`, 'm');
    return !key.test(registry);
  });
  assert.deepEqual(missing, [], `Ohne Zeichnung in icon.tsx: ${missing.join(', ')}`);
});

test('kein Emoji in der Oberfläche', () => {
  /**
   * Warum als Test und nicht als Stilfrage: Emojis sind wieder drin, sobald es
   * mal schnell gehen muss – und dann fällt es niemandem auf, weil es ja
   * „funktioniert". Für Screenreader funktioniert es nicht (vorgelesen wird der
   * Unicode-Name, nicht die Bedeutung), und jedes Betriebssystem zeichnet sie
   * anders.
   *
   * Geprüft wird auf `Extended_Pictographic`. Das trifft Emojis inklusive der
   * unauffälligen (⚠️, ✏️, ✖️) und lässt Typografie in Ruhe: ✓, ★, ✕, ›, ·, —
   * sind keine Emojis, sondern Schriftzeichen – genau die sind als Symbol
   * weiter erlaubt.
   */
  const emoji = /\p{Extended_Pictographic}/u;
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (emoji.test(line)) {
        const relative = file.slice(SRC.length + 1).replace(/\\/g, '/');
        offenders.push(`${relative}:${index + 1}  ${line.trim().slice(0, 80)}`);
      }
    });
  }

  assert.deepEqual(offenders, [], `Emoji im Quellcode:\n${offenders.join('\n')}`);
});
