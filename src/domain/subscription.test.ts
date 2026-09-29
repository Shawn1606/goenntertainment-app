import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PURCHASABLE_TIERS,
  effectiveTier,
  isKnownEntitlement,
  tierFromEntitlements,
} from './subscription.ts';

test('kaufbar sind alle Stufen mit Preis – Standard nicht', () => {
  assert.deepEqual(PURCHASABLE_TIERS, ['creator', 'business', 'business_plus']);
});

test('nur die kaufbaren Stufen sind bekannte Entitlements', () => {
  assert.equal(isKnownEntitlement('creator'), true);
  assert.equal(isKnownEntitlement('business_plus'), true);
  // 'standard' ist keine Ware: Es gibt kein Abo, das es freischaltet.
  assert.equal(isKnownEntitlement('standard'), false);
  assert.equal(isKnownEntitlement('premium'), false);
  assert.equal(isKnownEntitlement(null), false);
  assert.equal(isKnownEntitlement(undefined), false);
});

test('ohne Abo gilt Standard', () => {
  assert.equal(tierFromEntitlements([]), 'standard');
  assert.equal(tierFromEntitlements(null), 'standard');
  assert.equal(tierFromEntitlements(undefined), 'standard');
});

test('ein Entitlement schaltet genau seine Stufe frei', () => {
  assert.equal(tierFromEntitlements(['creator']), 'creator');
  assert.equal(tierFromEntitlements(['business']), 'business');
  assert.equal(tierFromEntitlements(['business_plus']), 'business_plus');
});

test('sind mehrere Abos aktiv, gewinnt die hoechste Stufe', () => {
  // Der Fall aus der Praxis: Beim Wechsel von Creator auf Business melden Apple
  // und Google fuer den Rest der laufenden Periode BEIDE Abos als aktiv. Wer das
  // erste Element nimmt, stuft jemanden zurueck, der gerade mehr bezahlt hat.
  assert.equal(tierFromEntitlements(['creator', 'business']), 'business');
  assert.equal(tierFromEntitlements(['business', 'creator']), 'business');
  assert.equal(tierFromEntitlements(['creator', 'business_plus', 'business']), 'business_plus');
});

test('unbekannte Entitlements werden verworfen, nicht geraten', () => {
  assert.equal(tierFromEntitlements(['premium', 'gold']), 'standard');
  // Neben Unbekanntem bleibt das Bekannte gueltig.
  assert.equal(tierFromEntitlements(['premium', 'creator']), 'creator');
});

test('ein Abo hebt die vergebene Stufe an', () => {
  assert.equal(effectiveTier('standard', 'business'), 'business');
  assert.equal(effectiveTier(null, 'creator'), 'creator');
});

test('ein Abo senkt eine vergebene Stufe NIEMALS', () => {
  // Der Fehler, den diese Funktion verhindert: Ein Partnerkonto hat dauerhaft
  // Business und probiert einen Monat Business Plus. Laeuft der aus, meldet
  // RevenueCat "keine Entitlements" – ohne das Maximum stuende das Konto danach
  // auf 'standard' und die dauerhafte Vergabe waere still verschwunden.
  assert.equal(effectiveTier('business', 'standard'), 'business');
  assert.equal(effectiveTier('business_plus', 'creator'), 'business_plus');
  assert.equal(effectiveTier('creator', null), 'creator');
});

test('gleiche Stufe auf beiden Wegen bleibt diese Stufe', () => {
  assert.equal(effectiveTier('business', 'business'), 'business');
});

test('ohne beides gilt Standard', () => {
  assert.equal(effectiveTier(null, null), 'standard');
  assert.equal(effectiveTier(undefined, undefined), 'standard');
});

test('der alte Wert "personal" zaehlt auch hier als Standard', () => {
  assert.equal(effectiveTier('personal', 'creator'), 'creator');
  assert.equal(effectiveTier('personal', null), 'standard');
});

test('Unsinn aus der Datenbank oder vom Webhook faellt auf Standard', () => {
  assert.equal(effectiveTier('enterprise', 'quatsch'), 'standard');
});
