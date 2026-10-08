import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passwordStrength } from './password-strength.ts';

const COMMON = ['passwort', 'password', 'hallo', 'schalke04', 'qwertz', '123456', 'geheim', 'ichliebedich'];

const score = (pw: string, personal: string[] = []) => passwordStrength(pw, { common: COMMON, personal }).score;

test('leer ist sehr schwach und sagt, was fehlt', () => {
  const r = passwordStrength('', { common: COMMON });
  assert.equal(r.score, 0);
  assert.equal(r.meetsPolicy, false);
  assert.ok(r.hints[0].includes('8 Zeichen'));
});

test('bekannte Passwörter bleiben schwach – auch mit Zahl, Großbuchstabe oder Leetspeak', () => {
  for (const pw of ['passwort', 'Passwort1', 'Passwort123!', 'P4ssw0rt', 'hallo123', 'Schalke04']) {
    assert.ok(score(pw) <= 1, `${pw} sollte schwach sein`);
  }
});

test('die Regel folgt genau dem Server: nur der exakte Listeneintrag wird abgelehnt', () => {
  // „schalke04" steht wörtlich in der Liste → der Server lehnt ab.
  assert.equal(passwordStrength('Schalke04', { common: COMMON }).meetsPolicy, false);
  // „hallo123" steht so nicht drin → der Server nimmt es an, auch wenn die Anzeige
  // es zu Recht schwach nennt. Die App darf hier nicht „wird abgelehnt" sagen.
  assert.equal(passwordStrength('hallo123', { common: COMMON }).meetsPolicy, true);
});

test('eine starke Passphrase ohne Zahl sagt, was der Server noch will', () => {
  const r = passwordStrength('korrekt pferd batterie heftklammer', { common: COMMON });
  assert.equal(r.meetsPolicy, false);
  assert.equal(r.hints[0], 'Die App verlangt mindestens eine Zahl.');
});

test('der eigene Name oder die E-Mail im Passwort zieht es nach unten', () => {
  assert.ok(score('Maximilian2026!x', ['maximilian@example.invalid']) <= 1);
  assert.equal(passwordStrength('Maximilian2026!x', { common: COMMON, personal: ['maximilian@example.invalid'] }).meetsPolicy, false);
});

test('die Mindestregel ist genau die des Servers (PasswordPolicy.php)', () => {
  // Umlaute zählen dort nicht als Buchstabe: ohne a–z wird abgelehnt – mit eigenem Tipp.
  const umlauts = passwordStrength('ääää1234', { common: COMMON });
  assert.equal(umlauts.meetsPolicy, false);
  assert.match(umlauts.hints[0], /a bis z/);
  // Länge in Zeichen: zwei Emoji sind zwei Zeichen, nicht vier.
  const face = '\u{1F600}';
  assert.equal(passwordStrength(`abc1${face}${face}`, { common: COMMON }).meetsPolicy, false);
  assert.equal(passwordStrength(`abcd1${face}${face}x`, { common: COMMON }).meetsPolicy, true);
  // Der Name zählt beim Server nicht – nur Benutzername und E-Mail (account).
  const named = { common: COMMON, personal: ['tester_42', 'post@example.invalid', 'Maximilian'], account: ['tester_42', 'post@example.invalid'] };
  assert.equal(passwordStrength('Maximilian2026', named).meetsPolicy, true);
  assert.ok(passwordStrength('Maximilian2026', named).score <= 1, 'die Bewertung warnt trotzdem');
  assert.equal(passwordStrength('xtester_42x9', named).meetsPolicy, false);
  assert.equal(passwordStrength('meinepost7x', named).meetsPolicy, false);
});

test('Tastatur- und Zahlenfolgen werden erkannt', () => {
  assert.ok(score('asdfgh12') <= 1);
  assert.ok(score('abcd1234') <= 1);
  const r = passwordStrength('abcd1234', { common: COMMON });
  assert.ok(r.hints.some((h) => h.includes('Folgen')));
});

test('zu kurz ist höchstens schwach, auch wenn es bunt aussieht', () => {
  assert.ok(score('aB3$x') <= 1);
});

test('die Server-Regel: 8 Zeichen, Buchstaben und Zahlen', () => {
  assert.equal(passwordStrength('fahrrad7', { common: COMMON }).meetsPolicy, true);
  assert.equal(passwordStrength('fahrradweg', { common: COMMON }).meetsPolicy, false);
  assert.equal(passwordStrength('12345678', { common: COMMON }).meetsPolicy, false);
});

test('lange Passphrasen sind stark, ohne Sonderzeichen-Zwang', () => {
  assert.ok(score('blaue fahrraeder tanzen 7') >= 3);
  assert.equal(score('Blaue-Fahrraeder-tanzen-im-Juli-7'), 4);
});

test('ein ordentliches, zufälliges Passwort ist mindestens stark', () => {
  assert.ok(score('tR7#kq2Lmz9!') >= 3);
});

test('Stärke steigt mit der Länge', () => {
  const a = score('kaffeetasse7');
  const b = score('kaffeetasse7 und kuchen');
  assert.ok(b >= a);
});

test('höchstens drei Tipps, und bei „Sehr stark" keine', () => {
  assert.ok(passwordStrength('a', { common: COMMON }).hints.length <= 3);
  assert.equal(passwordStrength('Blaue-Fahrraeder-tanzen-im-Juli-7', { common: COMMON }).hints.length, 0);
});
