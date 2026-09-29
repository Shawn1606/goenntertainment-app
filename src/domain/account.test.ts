import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_TIERS,
  accountAbilities,
  accountLabel,
  capabilitiesFor,
  formatPriceCents,
  nextTier,
  normalizeAccountType,
  rankOf,
  tierFor,
} from './account.ts';

test('die Leiter hat vier Stufen in aufsteigender Reihenfolge', () => {
  assert.deepEqual(
    ACCOUNT_TIERS.map((tier) => tier.type),
    ['standard', 'creator', 'business', 'business_plus'],
  );
});

test('Standard darf keine Events erstellen, Creator schon', () => {
  assert.equal(capabilitiesFor('standard').canCreateActivities, false);
  assert.equal(capabilitiesFor('creator').canCreateActivities, true);
});

test('den Business-Bereich gibt es erst ab Business', () => {
  assert.equal(capabilitiesFor('standard').hasBusinessArea, false);
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

test('Business Plus hebt mehr Events hervor und blickt weiter zurueck', () => {
  const business = capabilitiesFor('business');
  const plus = capabilitiesFor('business_plus');
  assert.ok(plus.boostSlots > business.boostSlots);
  assert.ok(plus.insightMonths > business.insightMonths);
});

test('jede Stufe kann mindestens so viel wie die darunter', () => {
  ACCOUNT_TIERS.forEach((tier, index) => {
    if (index === 0) return;
    const below = ACCOUNT_TIERS[index - 1].capabilities;
    const here = tier.capabilities;
    assert.ok(!below.canCreateActivities || here.canCreateActivities, `${tier.type}: erstellen`);
    assert.ok(!below.hasBusinessArea || here.hasBusinessArea, `${tier.type}: Business-Bereich`);
    assert.ok(!below.hasPublicProfile || here.hasPublicProfile, `${tier.type}: oeffentliches Profil`);
    assert.ok(here.boostSlots >= below.boostSlots, `${tier.type}: Hervorheben`);
    assert.ok(here.insightMonths >= below.insightMonths, `${tier.type}: Rueckblick`);
  });
});

test('der alte Wert "personal" gilt als Standard', () => {
  assert.equal(normalizeAccountType('personal'), 'standard');
  assert.equal(accountLabel('personal'), 'Standard');
});

test('fehlende oder unbekannte Werte fallen auf die kleinste Stufe', () => {
  assert.equal(normalizeAccountType(null), 'standard');
  assert.equal(normalizeAccountType(undefined), 'standard');
  assert.equal(normalizeAccountType('enterprise'), 'standard');
  assert.equal(capabilitiesFor('enterprise').canCreateActivities, false);
});

test('"business" aus der alten Welt bleibt Business', () => {
  assert.equal(normalizeAccountType('business'), 'business');
});

test('Rang und naechste Stufe folgen der Reihenfolge', () => {
  assert.equal(rankOf('standard'), 0);
  assert.ok(rankOf('business') > rankOf('creator'));
  assert.equal(nextTier('standard')?.type, 'creator');
  assert.equal(nextTier('business')?.type, 'business_plus');
  assert.equal(nextTier('business_plus'), null);
});

test('tierFor liefert immer eine Stufe – auch fuer Unsinn', () => {
  assert.equal(tierFor('quatsch').type, 'standard');
  assert.ok(tierFor('business').perks.length > 0);
});

test('Admins duerfen Events erstellen, auch als Standard-Konto', () => {
  const admin = accountAbilities({ account_type: 'standard', is_admin: true });
  assert.equal(admin.canCreateActivities, true);
});

test('alles ausser Erstellen bleibt auch fuer Admins an die Stufe gebunden', () => {
  // Sonst koennte ein Admin nie pruefen, was ein Standard-Konto wirklich sieht –
  // und die Zahlen im Business-Bereich wuerden den Vorzuegen der Stufe
  // widersprechen (etwa 5 Plaetze zum Hervorheben bei "1 Event gleichzeitig").
  assert.equal(accountAbilities({ account_type: 'standard', is_admin: true }).hasBusinessArea, false);
  assert.equal(accountAbilities({ account_type: 'business', is_admin: true }).hasBusinessArea, true);
  // Auch das Profil folgt der Stufe: Ein Admin auf Standard soll sehen, dass es
  // dort keins gibt – sonst prueft er eine Ansicht, die es fuer das Konto gar
  // nicht gibt.
  assert.equal(accountAbilities({ account_type: 'standard', is_admin: true }).hasPublicProfile, false);
  assert.equal(accountAbilities({ account_type: 'creator', is_admin: true }).hasPublicProfile, true);

  const adminBusiness = accountAbilities({ account_type: 'business', is_admin: true });
  assert.deepEqual(
    { slots: adminBusiness.boostSlots, months: adminBusiness.insightMonths },
    { slots: capabilitiesFor('business').boostSlots, months: capabilitiesFor('business').insightMonths },
  );
});

test('ohne Nutzer gilt die kleinste Stufe', () => {
  assert.equal(accountAbilities(null).canCreateActivities, false);
  assert.equal(accountAbilities(undefined).hasBusinessArea, false);
});

test('die Monatsbeitraege stehen in Cent und Standard ist kostenlos', () => {
  assert.equal(tierFor('standard').monthlyPriceCents, 0);
  assert.equal(tierFor('creator').monthlyPriceCents, 799);
  assert.equal(tierFor('business').monthlyPriceCents, 1499);
  assert.equal(tierFor('business_plus').monthlyPriceCents, 2999);
});

test('jede Stufe kostet mindestens so viel wie die darunter', () => {
  // Sonst waere die Leiter kaputt: Wer aufsteigt, zahlt mehr und bekommt mehr.
  // Ein Preis, der nach oben faellt, macht die naechste Stufe zum Abstieg.
  ACCOUNT_TIERS.forEach((tier, index) => {
    if (index === 0) return;
    assert.ok(
      tier.monthlyPriceCents >= ACCOUNT_TIERS[index - 1].monthlyPriceCents,
      `${tier.type}: Preis faellt gegenueber der Stufe darunter`,
    );
  });
});

test('nur Standard ist kostenlos – jede hoehere Stufe kostet etwas', () => {
  ACCOUNT_TIERS.forEach((tier, index) => {
    if (index === 0) assert.equal(tier.monthlyPriceCents, 0, 'Standard');
    else assert.ok(tier.monthlyPriceCents > 0, `${tier.type}: kostet nichts`);
  });
});

test('Preise stehen deutsch mit Komma und zwei Cent-Stellen', () => {
  assert.equal(formatPriceCents(799), '7,99 €');
  assert.equal(formatPriceCents(1499), '14,99 €');
  assert.equal(formatPriceCents(2999), '29,99 €');
});

test('die Cent-Stelle bleibt zweistellig', () => {
  // Der Fall, der ohne padStart falsch aussieht: "15,0 €" statt "15,00 €".
  assert.equal(formatPriceCents(1500), '15,00 €');
  assert.equal(formatPriceCents(1505), '15,05 €');
  assert.equal(formatPriceCents(5), '0,05 €');
  assert.equal(formatPriceCents(0), '0,00 €');
});

test('die Jahresbeitraege stehen in Cent und Standard ist kostenlos', () => {
  assert.equal(tierFor('standard').yearlyPriceCents, 0);
  assert.equal(tierFor('creator').yearlyPriceCents, 7990);
  assert.equal(tierFor('business').yearlyPriceCents, 14990);
  assert.equal(tierFor('business_plus').yearlyPriceCents, 29990);
});

test('kein Jahresbeitrag ist so hoch wie zwoelf Monatsbeitraege', () => {
  // Der Fehler, den dieser Test verhindert: Jemand aendert einen Preis von Hand
  // und das Jahresabo ist danach teurer als monatlich zahlen – waehrend im
  // Upgrade-Bildschirm weiter "2 Monate gratis" steht (siehe billing-period.ts,
  // das diese Zusage aus genau diesen zwei Zahlen ableitet).
  ACCOUNT_TIERS.forEach((tier) => {
    if (tier.yearlyPriceCents === 0) return; // Stufe ohne Jahresabo
    assert.ok(
      tier.yearlyPriceCents < tier.monthlyPriceCents * 12,
      `${tier.type}: Jahresabo spart nichts`,
    );
  });
});

test('eine Stufe mit Preis hat auch einen Jahrespreis', () => {
  // Umgekehrt darf es eine Stufe ohne Jahresabo geben – der Umschalter im
  // Upgrade-Bildschirm verschwindet dann von selbst (periodsFor). Solange aber
  // alle drei bezahlten Stufen eines haben, soll keine still herausfallen.
  ACCOUNT_TIERS.forEach((tier) => {
    if (tier.monthlyPriceCents === 0) return; // Standard
    assert.ok(tier.yearlyPriceCents > 0, `${tier.type}: kein Jahrespreis`);
  });
});
