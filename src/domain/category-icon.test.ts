import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATEGORY_ICON_FALLBACK, CATEGORY_ICON_NAMES, categoryIcon } from './category-icon.ts';

test('categoryIcon: der Icon-Slug aus dem Seed gewinnt', () => {
  assert.equal(categoryIcon({ name: 'Irgendwas', icon: 'basketball' }), 'ball');
  assert.equal(categoryIcon({ name: 'Egal', icon: 'cooking' }), 'cooking');
});

test('categoryIcon: ohne Slug greift das Stichwort im Namen', () => {
  assert.equal(categoryIcon({ name: 'Sport & Radfahren' }), 'bike');
  assert.equal(categoryIcon({ name: 'Fotografie', icon: null }), 'camera');
  assert.equal(categoryIcon({ name: 'Gemeinsam Kochen' }), 'cooking');
});

test('categoryIcon: Groß-/Kleinschreibung ist egal', () => {
  assert.equal(categoryIcon({ name: 'GAMING' }), 'gamepad');
  assert.equal(categoryIcon({ name: 'x', icon: 'MUSIC' }), 'music');
});

test('categoryIcon: unbekannte Kategorie bekommt das Rückfall-Icon', () => {
  assert.equal(categoryIcon({ name: 'Völlig Neues' }), CATEGORY_ICON_FALLBACK);
  assert.equal(categoryIcon(null), CATEGORY_ICON_FALLBACK);
  assert.equal(categoryIcon({}), CATEGORY_ICON_FALLBACK);
});

test('categoryIcon: liefert immer einen Namen, den das Icon-Set kennt', () => {
  const names: readonly string[] = CATEGORY_ICON_NAMES;
  // Jeder mögliche Rückgabewert muss im deklarierten Namensraum liegen –
  // sonst hätte das Komponenten-Set eine Lücke ohne SVG.
  for (const probe of ['basketball', 'radfahren', 'yoga', 'konzert', 'reise', 'kaffee', 'unbekannt']) {
    assert.ok(names.includes(categoryIcon({ name: probe })), `${probe} → ausserhalb des Namensraums`);
  }
  assert.ok(names.includes(CATEGORY_ICON_FALLBACK));
});
