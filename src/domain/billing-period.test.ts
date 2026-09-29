import test from 'node:test';
import assert from 'node:assert/strict';

import { ACCOUNT_TIERS } from './account.ts';
import {
  BILLING_PERIODS,
  DEFAULT_BILLING_PERIOD,
  billingPeriodAdverb,
  billingPeriodLabel,
  freeMonths,
  hasYearlyPlan,
  monthlyEquivalentCents,
  monthlyEquivalentLabel,
  normalizeBillingPeriod,
  periodsFor,
  priceCentsFor,
  priceLabel,
  savedCentsPerYear,
  savingsLabel,
  savingsPercent,
} from './billing-period.ts';

test('es gibt genau zwei Rhythmen, das Monatsabo zuerst', () => {
  assert.deepEqual(
    BILLING_PERIODS.map((option) => option.period),
    ['monthly', 'yearly'],
  );
  assert.equal(billingPeriodLabel('monthly'), 'Monatlich');
  assert.equal(billingPeriodLabel('yearly'), 'Jährlich');
});

test('im Satz steht der Zeitraum klein', () => {
  // Fuer Zeilen wie "Business jaehrlich angefragt".
  assert.equal(billingPeriodAdverb('monthly'), 'monatlich');
  assert.equal(billingPeriodAdverb('yearly'), 'jährlich');
});

test('vorausgewaehlt ist das Jahresabo', () => {
  // Anzeige-Entscheidung: Es ist das guenstigere Angebot, und der Monatspreis
  // steht sichtbar daneben.
  assert.equal(DEFAULT_BILLING_PERIOD, 'yearly');
});

test('eingelesen wird im Zweifel MONATLICH – nicht die Vorauswahl', () => {
  // Die wichtigste Zeile dieser Datei: Was aus Datenbank oder Netz kommt und
  // unverstaendlich ist, darf niemanden auf ein Jahr festlegen.
  assert.equal(normalizeBillingPeriod('yearly'), 'yearly');
  assert.equal(normalizeBillingPeriod('monthly'), 'monthly');
  assert.equal(normalizeBillingPeriod('jaehrlich'), 'monthly');
  assert.equal(normalizeBillingPeriod('YEARLY'), 'monthly');
  assert.equal(normalizeBillingPeriod(''), 'monthly');
  assert.equal(normalizeBillingPeriod(null), 'monthly');
  assert.equal(normalizeBillingPeriod(undefined), 'monthly');
});

test('die Preise kommen aus der Stufe, je Rhythmus', () => {
  assert.equal(priceCentsFor('creator', 'monthly'), 799);
  assert.equal(priceCentsFor('creator', 'yearly'), 7990);
  assert.equal(priceCentsFor('business', 'yearly'), 14990);
  assert.equal(priceCentsFor('business_plus', 'yearly'), 29990);
  assert.equal(priceCentsFor('standard', 'monthly'), 0);
  assert.equal(priceCentsFor('standard', 'yearly'), 0);
});

test('unbekannte Stufen kosten nichts, statt einen Preis zu erfinden', () => {
  // Gleiche Richtung wie bei den Rechten: im Zweifel die kleinste Stufe.
  assert.equal(priceCentsFor('enterprise', 'yearly'), 0);
  assert.equal(priceCentsFor(null, 'monthly'), 0);
  assert.equal(priceCentsFor('personal', 'yearly'), 0);
});

test('der Preis steht als Zeile mit Zeitraum', () => {
  assert.equal(priceLabel('creator', 'monthly'), '7,99 € / Monat');
  assert.equal(priceLabel('creator', 'yearly'), '79,90 € / Jahr');
  assert.equal(priceLabel('business', 'monthly'), '14,99 € / Monat');
  assert.equal(priceLabel('business', 'yearly'), '149,90 € / Jahr');
  assert.equal(priceLabel('business_plus', 'yearly'), '299,90 € / Jahr');
});

test('ohne Preis steht "kostenlos" und nicht "0,00 €"', () => {
  // "0,00 € / Jahr" liest sich wie ein Anzeigefehler.
  assert.equal(priceLabel('standard', 'monthly'), 'kostenlos');
  assert.equal(priceLabel('standard', 'yearly'), 'kostenlos');
  assert.equal(priceLabel(null, 'yearly'), 'kostenlos');
});

test('nur Stufen mit Preis haben ueberhaupt einen Rhythmus zur Wahl', () => {
  assert.deepEqual(
    periodsFor('creator').map((option) => option.period),
    ['monthly', 'yearly'],
  );
  // Standard kostet nichts, also gibt es nichts zu wählen – der Umschalter im
  // Upgrade-Bildschirm verschwindet damit von selbst.
  assert.deepEqual(periodsFor('standard'), []);
  assert.deepEqual(periodsFor('enterprise'), []);
  assert.equal(hasYearlyPlan('business_plus'), true);
  assert.equal(hasYearlyPlan('standard'), false);
});

test('der Monats-Vergleichspreis wird AUFgerundet', () => {
  // 7990 / 12 = 665,83. Abgerundet stuenden "6,65 € pro Monat" an einem Abo,
  // das aufs Jahr 79,80 € kostete – zehn Cent weniger als der wahre Preis.
  assert.equal(monthlyEquivalentCents('creator'), 666);
  assert.equal(monthlyEquivalentLabel('creator'), 'entspricht 6,66 € pro Monat');
  assert.equal(monthlyEquivalentCents('business'), 1250);
  assert.equal(monthlyEquivalentLabel('business'), 'entspricht 12,50 € pro Monat');
  assert.equal(monthlyEquivalentCents('business_plus'), 2500);
});

test('zwoelf Vergleichspreise sind nie weniger als der Jahrespreis', () => {
  // Die Eigenschaft, um die es beim Aufrunden geht – fuer jede Stufe geprueft,
  // damit ein neuer Preis sie nicht still verletzt.
  ACCOUNT_TIERS.forEach((tier) => {
    if (tier.yearlyPriceCents === 0) return;
    assert.ok(
      monthlyEquivalentCents(tier.type) * 12 >= tier.yearlyPriceCents,
      `${tier.type}: Vergleichspreis liegt unter dem Jahrespreis`,
    );
  });
});

test('ohne Jahresabo gibt es keinen Vergleichspreis und keinen Nachsatz', () => {
  assert.equal(monthlyEquivalentCents('standard'), 0);
  assert.equal(monthlyEquivalentLabel('standard'), null);
  assert.equal(monthlyEquivalentLabel(null), null);
});

test('die Ersparnis ist zwei Monatsbeitraege je Stufe', () => {
  assert.equal(savedCentsPerYear('creator'), 1598);
  assert.equal(freeMonths('creator'), 2);
  assert.equal(savedCentsPerYear('business'), 2998);
  assert.equal(freeMonths('business'), 2);
  assert.equal(savedCentsPerYear('business_plus'), 5998);
  assert.equal(freeMonths('business_plus'), 2);
});

test('der Nachlass wird ABgerundet', () => {
  // 1598 von 9588 sind 16,67 % – aufgerundet stuenden 17 % da, also mehr
  // Nachlass, als das Angebot hergibt.
  assert.equal(savingsPercent('creator'), 16);
  assert.equal(savingsPercent('business'), 16);
  assert.equal(savingsPercent('business_plus'), 16);
});

test('das Etikett nennt ganze Monate, sonst Prozente', () => {
  assert.equal(savingsLabel('creator'), '2 Monate gratis');
  assert.equal(savingsLabel('business'), '2 Monate gratis');
  assert.equal(savingsLabel('business_plus'), '2 Monate gratis');
});

test('ohne Ersparnis gibt es kein Etikett statt "0 % guenstiger"', () => {
  assert.equal(savingsLabel('standard'), null);
  assert.equal(savingsLabel(null), null);
  assert.equal(savedCentsPerYear('standard'), 0);
  assert.equal(freeMonths('standard'), 0);
  assert.equal(savingsPercent('standard'), 0);
});
