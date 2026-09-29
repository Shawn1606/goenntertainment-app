import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SOCIAL_LINKS,
  SOCIAL_PLATFORMS,
  displaySocialLink,
  normalizeSocialInput,
  platformInfo,
  sortLinks,
} from './social-links.ts';

test('jede Plattform hat Schluessel, Namen und Beispiel', () => {
  assert.ok(SOCIAL_PLATFORMS.length > 0);
  SOCIAL_PLATFORMS.forEach((p) => {
    assert.ok(p.key.length > 0, 'key');
    assert.ok(p.label.length > 0, `${p.key}: label`);
    assert.ok(p.placeholder.length > 0, `${p.key}: placeholder`);
  });
});

test('die Schluessel sind eindeutig', () => {
  const keys = SOCIAL_PLATFORMS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('man kann hoechstens so viele Links setzen, wie es Plattformen gibt', () => {
  // Pro Plattform genau ein Link – mehr waere in der Anzeige nicht unterscheidbar.
  assert.equal(MAX_SOCIAL_LINKS, SOCIAL_PLATFORMS.length);
});

test('ein Handle wird zur vollstaendigen Adresse', () => {
  assert.deepEqual(normalizeSocialInput('instagram', 'goenn4fun'), {
    ok: true,
    url: 'https://instagram.com/goenn4fun',
  });
});

test('das fuehrende @ darf mit dabei sein', () => {
  assert.deepEqual(normalizeSocialInput('tiktok', '@goenn4fun'), {
    ok: true,
    url: 'https://tiktok.com/@goenn4fun',
  });
});

test('Leerraum aussen herum stoert nicht', () => {
  const result = normalizeSocialInput('instagram', '  goenn4fun  ');
  assert.equal(result.ok && result.url, 'https://instagram.com/goenn4fun');
});

test('eine schon vollstaendige Adresse bleibt, wie sie ist', () => {
  assert.deepEqual(normalizeSocialInput('instagram', 'https://instagram.com/goenn4fun'), {
    ok: true,
    url: 'https://instagram.com/goenn4fun',
  });
});

test('http bleibt erlaubt, alles andere nicht', () => {
  assert.equal(normalizeSocialInput('website', 'http://goenn4fun.de').ok, true);
  // Das ist der eigentliche Grund fuer diese Pruefung: Ein solcher Link wird in
  // der App angetippt. javascript: oder data: duerfen dort nie landen.
  assert.equal(normalizeSocialInput('website', 'javascript:alert(1)').ok, false);
  assert.equal(normalizeSocialInput('website', 'data:text/html,hi').ok, false);
  assert.equal(normalizeSocialInput('website', 'ftp://example.com').ok, false);
});

test('die eigene Seite darf eine nackte Domain sein', () => {
  assert.deepEqual(normalizeSocialInput('website', 'goenn4fun.de'), {
    ok: true,
    url: 'https://goenn4fun.de',
  });
});

test('die eigene Seite braucht eine Domain, kein Handle', () => {
  assert.equal(normalizeSocialInput('website', 'goenn4fun').ok, false);
});

test('leere Eingaben sind kein Link', () => {
  assert.equal(normalizeSocialInput('instagram', '').ok, false);
  assert.equal(normalizeSocialInput('instagram', '   ').ok, false);
});

test('Unsinn im Handle wird abgelehnt', () => {
  assert.equal(normalizeSocialInput('instagram', 'zwei woerter').ok, false);
  assert.equal(normalizeSocialInput('instagram', 'a/b').ok, false);
});

test('sehr lange Eingaben werden abgelehnt', () => {
  assert.equal(normalizeSocialInput('website', `https://x.de/${'a'.repeat(500)}`).ok, false);
});

test('unbekannte Plattformen gibt es nicht', () => {
  assert.equal(normalizeSocialInput('myspace', 'goenn').ok, false);
  assert.equal(platformInfo('myspace'), null);
});

test('abgelehnte Eingaben sagen, was fehlt', () => {
  const result = normalizeSocialInput('instagram', 'a/b');
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.length > 0);
});

test('angezeigt wird das Handle, nicht die lange Adresse', () => {
  assert.equal(displaySocialLink('instagram', 'https://instagram.com/goenn4fun'), '@goenn4fun');
  assert.equal(displaySocialLink('tiktok', 'https://tiktok.com/@goenn4fun'), '@goenn4fun');
});

test('bei der eigenen Seite steht die Domain', () => {
  assert.equal(displaySocialLink('website', 'https://goenn4fun.de/team'), 'goenn4fun.de/team');
  assert.equal(displaySocialLink('website', 'https://www.goenn4fun.de'), 'goenn4fun.de');
});

test('unlesbare Adressen zeigt die Anzeige unveraendert', () => {
  assert.equal(displaySocialLink('website', 'kaputt'), 'kaputt');
});

test('Links stehen immer in derselben Reihenfolge wie die Plattformliste', () => {
  const order = SOCIAL_PLATFORMS.map((p) => p.key);
  const shuffled = [...order].reverse().map((platform) => ({ platform, url: 'https://x.de' }));
  assert.deepEqual(
    sortLinks(shuffled).map((l) => l.platform),
    order,
  );
});

test('unbekannte Plattformen sortieren nach hinten, statt zu verschwinden', () => {
  const sorted = sortLinks([
    { platform: 'myspace', url: 'https://x.de' },
    { platform: SOCIAL_PLATFORMS[0].key, url: 'https://y.de' },
  ]);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].platform, SOCIAL_PLATFORMS[0].key);
});
