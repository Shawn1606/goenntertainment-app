/**
 * Pruefung der Social-Links auf der Server-Seite – reine Logik, ohne Datenbank.
 *
 * Der Server macht hier BEWUSST weniger als die App: Er baut keine Adressen aus
 * Handles (das ist Bequemlichkeit und gehoert in src/domain/social-links.ts),
 * sondern prueft nur, was gespeichert werden darf. Deshalb gibt es hier auch
 * keine zweite Liste von Handle-Praefixen, die auseinanderlaufen koennte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_LINK_LENGTH, MAX_SOCIAL_LINKS, SOCIAL_PLATFORMS, parseLinkList } from '../src/social.js';

test('die Plattformliste ist nicht leer und eindeutig', () => {
  assert.ok(SOCIAL_PLATFORMS.length > 0);
  assert.equal(new Set(SOCIAL_PLATFORMS).size, SOCIAL_PLATFORMS.length);
  assert.equal(MAX_SOCIAL_LINKS, SOCIAL_PLATFORMS.length);
});

test('eine gueltige Liste kommt sauber zurueck', () => {
  const result = parseLinkList([
    { platform: 'instagram', url: 'https://instagram.com/goenn4fun' },
    { platform: 'website', url: 'http://goenn4fun.de' },
  ]);
  assert.equal(result.error, null);
  assert.deepEqual(result.links, [
    { platform: 'instagram', url: 'https://instagram.com/goenn4fun' },
    { platform: 'website', url: 'http://goenn4fun.de' },
  ]);
});

test('eine leere Liste ist erlaubt – so raeumt man alle Links weg', () => {
  const result = parseLinkList([]);
  assert.equal(result.error, null);
  assert.deepEqual(result.links, []);
});

test('was keine Liste ist, wird abgelehnt', () => {
  assert.ok(parseLinkList(null).error);
  assert.ok(parseLinkList('instagram').error);
  assert.ok(parseLinkList({ platform: 'instagram', url: 'https://x.de' }).error);
});

test('nur http und https duerfen gespeichert werden', () => {
  // Der Grund: Diese Adresse wird in der App angetippt.
  assert.ok(parseLinkList([{ platform: 'website', url: 'javascript:alert(1)' }]).error);
  assert.ok(parseLinkList([{ platform: 'website', url: 'data:text/html,hi' }]).error);
  assert.ok(parseLinkList([{ platform: 'website', url: 'goenn4fun.de' }]).error);
});

test('unbekannte Plattformen werden abgelehnt', () => {
  assert.ok(parseLinkList([{ platform: 'myspace', url: 'https://myspace.com/x' }]).error);
});

test('dieselbe Plattform zweimal wird abgelehnt', () => {
  const result = parseLinkList([
    { platform: 'instagram', url: 'https://instagram.com/a' },
    { platform: 'instagram', url: 'https://instagram.com/b' },
  ]);
  assert.ok(result.error);
});

test('mehr Links als Plattformen gibt es nicht', () => {
  const tooMany = [...SOCIAL_PLATFORMS, 'instagram'].map((platform) => ({
    platform,
    url: 'https://goenn4fun.de',
  }));
  assert.ok(parseLinkList(tooMany).error);
});

test('zu lange Adressen werden abgelehnt', () => {
  const url = `https://goenn4fun.de/${'a'.repeat(MAX_LINK_LENGTH)}`;
  assert.ok(parseLinkList([{ platform: 'website', url }]).error);
});

test('Leerraum aussen herum wird abgeschnitten', () => {
  const result = parseLinkList([{ platform: 'website', url: '  https://goenn4fun.de  ' }]);
  assert.equal(result.error, null);
  assert.equal(result.links[0].url, 'https://goenn4fun.de');
});

test('leere Eintraege fallen raus, statt die Liste zu kippen', () => {
  const result = parseLinkList([
    { platform: 'website', url: '   ' },
    { platform: 'instagram', url: 'https://instagram.com/goenn4fun' },
  ]);
  assert.equal(result.error, null);
  assert.deepEqual(result.links, [{ platform: 'instagram', url: 'https://instagram.com/goenn4fun' }]);
});
