/**
 * Rechte je Kontostufe – reine Logik, ohne Datenbank.
 *
 * Haelt fest, was der Server tatsaechlich verbietet. Das Gegenstueck in der App
 * ist src/domain/account.test.ts; laufen die beiden auseinander, faellt es hier
 * oder dort auf.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_TYPES,
  REQUESTABLE_ACCOUNT_TYPES,
  SELF_SERVICE_ACCOUNT_TYPES,
  abilitiesFor,
  capabilitiesFor,
  normalizeAccountType,
  rankOf,
  requestableTypesFor,
} from '../src/accounts.js';

test('die Leiter hat vier Stufen in aufsteigender Reihenfolge', () => {
  assert.deepEqual(ACCOUNT_TYPES, ['standard', 'creator', 'business', 'business_plus']);
});

test('selbst geben darf man sich nur Standard', () => {
  assert.deepEqual(SELF_SERVICE_ACCOUNT_TYPES, ['standard']);
  SELF_SERVICE_ACCOUNT_TYPES.forEach((type) => assert.ok(ACCOUNT_TYPES.includes(type)));
});

test('jede Stufe ist entweder Selbstbedienung oder anfragbar, nie beides', () => {
  // Genau hier lag die Luecke: 'creator' stand in BEIDEN Listen. Damit liess
  // sich die Bestaetigung im Admin-Panel umgehen – ein neues Konto gleich als
  // Creator anlegen, und die Warteschlange war ueberfluessig.
  ACCOUNT_TYPES.forEach((type) => {
    const selfService = SELF_SERVICE_ACCOUNT_TYPES.includes(type);
    const requestable = REQUESTABLE_ACCOUNT_TYPES.includes(type);
    assert.ok(selfService !== requestable, `${type} muss genau eins von beidem sein`);
  });
});

test('Standard darf keine Events erstellen, Creator schon', () => {
  assert.equal(capabilitiesFor('standard').canCreateActivities, false);
  assert.equal(capabilitiesFor('creator').canCreateActivities, true);
});

test('den Business-Bereich gibt es erst ab Business', () => {
  assert.equal(capabilitiesFor('creator').hasBusinessArea, false);
  assert.equal(capabilitiesFor('business').hasBusinessArea, true);
  assert.equal(capabilitiesFor('business_plus').hasBusinessArea, true);
});

test('ein oeffentliches Profil gibt es ab Creator', () => {
  assert.equal(capabilitiesFor('standard').hasPublicProfile, false);
  assert.equal(capabilitiesFor('creator').hasPublicProfile, true);
  assert.equal(capabilitiesFor('business').hasPublicProfile, true);
  assert.equal(capabilitiesFor('business_plus').hasPublicProfile, true);
});

test('der alte Wert "personal" gilt als Standard', () => {
  assert.equal(normalizeAccountType('personal'), 'standard');
});

test('fehlende oder unbekannte Werte fallen auf die kleinste Stufe', () => {
  assert.equal(normalizeAccountType(null), 'standard');
  assert.equal(normalizeAccountType('enterprise'), 'standard');
  assert.equal(rankOf(null), 0);
});

test('Admins duerfen Events anlegen, ganz gleich auf welcher Stufe', () => {
  assert.equal(abilitiesFor({ account_type: 'standard', is_admin: 1 }).canCreateActivities, true);
  assert.equal(abilitiesFor({ account_type: 'standard', is_admin: 0 }).canCreateActivities, false);
});

test('alles ausser Anlegen bleibt auch fuer Admins an die Stufe gebunden', () => {
  assert.equal(abilitiesFor({ account_type: 'creator', is_admin: 1 }).hasBusinessArea, false);
  assert.equal(abilitiesFor({ account_type: 'business', is_admin: 1 }).hasBusinessArea, true);
  // Ein Admin auf Business hat genau die Business-Plaetze – nicht mehr.
  assert.equal(
    abilitiesFor({ account_type: 'business', is_admin: 1 }).boostSlots,
    capabilitiesFor('business').boostSlots,
  );
  // Auch das oeffentliche Profil: ein Admin auf Standard hat keins.
  assert.equal(abilitiesFor({ account_type: 'standard', is_admin: 1 }).hasPublicProfile, false);
  assert.equal(abilitiesFor({ account_type: 'creator', is_admin: 1 }).hasPublicProfile, true);
});

test('ohne Nutzer gilt die kleinste Stufe', () => {
  assert.equal(abilitiesFor(null).canCreateActivities, false);
  assert.equal(abilitiesFor(undefined).hasBusinessArea, false);
});

test('anfragen kann man jede Stufe ausser Standard', () => {
  assert.deepEqual(REQUESTABLE_ACCOUNT_TYPES, ['creator', 'business', 'business_plus']);
  REQUESTABLE_ACCOUNT_TYPES.forEach((type) => assert.ok(ACCOUNT_TYPES.includes(type)));
});

test('angefragt werden kann nur nach oben', () => {
  assert.deepEqual(requestableTypesFor('standard'), ['creator', 'business', 'business_plus']);
  assert.deepEqual(requestableTypesFor('creator'), ['business', 'business_plus']);
  assert.deepEqual(requestableTypesFor('business'), ['business_plus']);
  // Auf der hoechsten Stufe bleibt nichts uebrig – die App zeigt dann keinen Knopf.
  assert.deepEqual(requestableTypesFor('business_plus'), []);
  // Altwerte laufen ueber dieselbe Leiter: 'personal' ist Standard.
  assert.deepEqual(requestableTypesFor('personal'), ['creator', 'business', 'business_plus']);
});
