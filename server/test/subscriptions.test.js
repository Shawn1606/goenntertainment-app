/**
 * Abo-Logik des Servers – reine Funktionen, ohne Datenbank.
 *
 * Haelt die Regeln fest, an denen ein Abo-System typischerweise scheitert: eine
 * Kuendigung, die zu frueh abschaltet, und ein verspaeteter Webhook, der ein
 * bezahltes Konto zurueckstuft. Das Gegenstueck in der App ist
 * src/domain/subscription.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BILLING_PERIODS,
  PURCHASABLE_ENTITLEMENTS,
  effectiveTier,
  isKnownEntitlement,
  msToDateTime,
  normalizeBillingPeriod,
  providerFromStore,
  statusForEventType,
  tierFromEntitlements,
} from '../src/subscriptions.js';

test('kaufbar sind alle Stufen ausser Standard', () => {
  assert.deepEqual(PURCHASABLE_ENTITLEMENTS, ['creator', 'business', 'business_plus']);
});

test('es gibt zwei Zahlungsrhythmen', () => {
  // Gleiche Liste wie src/domain/billing-period.ts in der App.
  assert.deepEqual(BILLING_PERIODS, ['monthly', 'yearly']);
});

test('ein unverstaendlicher Rhythmus wird monatlich, nicht jaehrlich', () => {
  // Die Richtung ist der Punkt: Was falsch ankommt, fuehrt zur kleineren
  // Verpflichtung – niemand steht wegen eines vertippten Feldes als
  // Jahreskunde in der Admin-Liste.
  assert.equal(normalizeBillingPeriod('yearly'), 'yearly');
  assert.equal(normalizeBillingPeriod('monthly'), 'monthly');
  assert.equal(normalizeBillingPeriod('YEARLY'), 'monthly');
  assert.equal(normalizeBillingPeriod('jaehrlich'), 'monthly');
  assert.equal(normalizeBillingPeriod(null), 'monthly');
  assert.equal(normalizeBillingPeriod(undefined), 'monthly');
});

test('das Jahresabo aendert an der Stufe nichts', () => {
  // Beide Produkte einer Stufe haengen bei RevenueCat am selben Entitlement.
  // Deshalb kommt der Rhythmus in dieser Rechnung gar nicht vor – gaebe es je
  // ein Entitlement 'creator_yearly', waere es hier unbekannt und wirkungslos.
  assert.equal(tierFromEntitlements(['creator']), 'creator');
  assert.equal(tierFromEntitlements(['creator_yearly']), 'standard');
  assert.equal(isKnownEntitlement('creator_yearly'), false);
});

test('eine Kuendigung nimmt den Zugang NICHT weg', () => {
  // Der wichtigste Test in dieser Datei. CANCELLATION heisst nur: keine
  // automatische Verlaengerung. Bezahlt ist bis zum Ende der Periode, und erst
  // dann kommt EXPIRATION. Wer hier 'expired' zurueckgibt, nimmt Leuten Wochen
  // weg, die sie bezahlt haben.
  assert.equal(statusForEventType('CANCELLATION'), null);
});

test('eine haengende Zahlung nimmt den Zugang NICHT weg', () => {
  // Der Store versucht es erneut. Scheitert es endgueltig, kommt EXPIRATION.
  assert.equal(statusForEventType('BILLING_ISSUE'), 'grace');
});

test('nur Ablauf und Pause schalten ab', () => {
  assert.equal(statusForEventType('EXPIRATION'), 'expired');
  assert.equal(statusForEventType('SUBSCRIPTION_PAUSED'), 'expired');
});

test('Kauf, Verlaengerung und Wechsel geben Zugang', () => {
  for (const type of [
    'INITIAL_PURCHASE',
    'RENEWAL',
    'UNCANCELLATION',
    'PRODUCT_CHANGE',
    'SUBSCRIPTION_EXTENDED',
    'NON_RENEWING_PURCHASE',
    'TRANSFER',
    'REFUND_REVERSED',
  ]) {
    assert.equal(statusForEventType(type), 'active', type);
  }
});

test('alles Unbekannte aendert nichts', () => {
  // RevenueCat schickt auch Paywall-Aufrufe, Tests und Experimente. Im Zweifel
  // wird kein Zugang genommen.
  assert.equal(statusForEventType('PAYWALL_IMPRESSION'), null);
  assert.equal(statusForEventType('TEST'), null);
  assert.equal(statusForEventType('WAS_AUCH_IMMER'), null);
  assert.equal(statusForEventType(undefined), null);
});

test('nur die kaufbaren Stufen sind bekannte Entitlements', () => {
  assert.equal(isKnownEntitlement('business'), true);
  assert.equal(isKnownEntitlement('standard'), false);
  assert.equal(isKnownEntitlement('premium'), false);
  assert.equal(isKnownEntitlement(null), false);
});

test('bei mehreren aktiven Abos gewinnt die hoechste Stufe', () => {
  assert.equal(tierFromEntitlements(['creator', 'business']), 'business');
  assert.equal(tierFromEntitlements(['business', 'creator']), 'business');
  assert.equal(tierFromEntitlements(['creator']), 'creator');
});

test('ohne Abo oder mit Unsinn gilt Standard', () => {
  assert.equal(tierFromEntitlements([]), 'standard');
  assert.equal(tierFromEntitlements(null), 'standard');
  assert.equal(tierFromEntitlements('creator'), 'standard');
  assert.equal(tierFromEntitlements(['premium']), 'standard');
});

test('ein Abo hebt die vergebene Stufe an, senkt sie aber nie', () => {
  assert.equal(effectiveTier('standard', 'business'), 'business');
  assert.equal(effectiveTier('business', 'standard'), 'business');
  assert.equal(effectiveTier('business_plus', 'creator'), 'business_plus');
  assert.equal(effectiveTier(null, null), 'standard');
  assert.equal(effectiveTier('personal', null), 'standard');
});

test('die App und die App-Store-Varianten landen im selben Provider', () => {
  assert.equal(providerFromStore('APP_STORE'), 'app_store');
  assert.equal(providerFromStore('MAC_APP_STORE'), 'app_store');
  assert.equal(providerFromStore('PLAY_STORE'), 'play_store');
  assert.equal(providerFromStore('play_store'), 'play_store');
  assert.equal(providerFromStore('STRIPE'), 'stripe');
  assert.equal(providerFromStore('PROMOTIONAL'), 'promotional');
});

test('ein unbekannter Store bleibt lesbar statt zu werfen', () => {
  assert.equal(providerFromStore('AMAZON'), 'unknown');
  assert.equal(providerFromStore(null), 'unknown');
  assert.equal(providerFromStore(undefined), 'unknown');
});

test('Millisekunden werden zu einer DB-DateTime in UTC', () => {
  assert.equal(msToDateTime(1767225600000), '2026-01-01 00:00:00');
});

test('fehlende oder unbrauchbare Zeitstempel ergeben null', () => {
  // NULL heisst in der Spalte "laeuft ohne Ende" – deshalb darf hier nichts
  // erfunden werden, etwa das aktuelle Datum.
  assert.equal(msToDateTime(null), null);
  assert.equal(msToDateTime(undefined), null);
  assert.equal(msToDateTime('1767225600000'), null);
  assert.equal(msToDateTime(Number.NaN), null);
});
