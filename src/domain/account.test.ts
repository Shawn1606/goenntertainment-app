import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_TIERS,
  accountAbilities,
  accountLabel,
  capabilitiesFor,
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
