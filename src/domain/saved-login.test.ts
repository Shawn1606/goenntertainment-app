import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LEGACY_CREDENTIALS_KEY,
  SAVED_EMAIL_KEY,
  emailFromLegacy,
  migrateLegacyEntry,
  normalizeSavedEmail,
  type KeyValueStore,
} from './saved-login.ts';

const FAKE_PASSWORD = 'fake-saved-password-not-a-secret';

test('a legacy entry gives back the e-mail address and nothing else', () => {
  const raw = JSON.stringify({ email: ' someone@example.invalid ', password: FAKE_PASSWORD });
  const email = emailFromLegacy(raw);

  assert.equal(email, 'someone@example.invalid');
  assert.equal(typeof email, 'string', 'only the address, never the object with the password');
  assert.equal(String(email).includes(FAKE_PASSWORD), false);
});

test('missing, malformed or address-less legacy entries give nothing', () => {
  for (const raw of [
    null,
    undefined,
    '',
    'not json',
    '"just a string"',
    '42',
    'null',
    JSON.stringify({ password: FAKE_PASSWORD }),
    JSON.stringify({ email: 42, password: FAKE_PASSWORD }),
    JSON.stringify({ email: '   ', password: FAKE_PASSWORD }),
    JSON.stringify([{ email: 'someone@example.invalid' }]),
  ]) {
    assert.equal(emailFromLegacy(raw), null, String(raw));
  }
});

test('a saved address is trimmed, and empty or over-long values are not saved', () => {
  assert.equal(normalizeSavedEmail('  a@b.de '), 'a@b.de');
  assert.equal(normalizeSavedEmail(''), null);
  assert.equal(normalizeSavedEmail('   '), null);
  assert.equal(normalizeSavedEmail(null), null);
  assert.equal(normalizeSavedEmail({ email: 'a@b.de' }), null);
  assert.equal(normalizeSavedEmail(`${'a'.repeat(250)}@b.de`), null);
});

test('the new entry has its own key, apart from the legacy one', () => {
  assert.equal(LEGACY_CREDENTIALS_KEY, 'goenn_saved_credentials');
  assert.notEqual(SAVED_EMAIL_KEY, LEGACY_CREDENTIALS_KEY);
  // expo-secure-store accepts letters, digits, '.', '-' and '_' in keys.
  assert.match(SAVED_EMAIL_KEY, /^[A-Za-z0-9._-]+$/);
});

/**
 * A store in memory standing in for SecureStore / localStorage. `fail` makes one kind of call
 * throw, the way a device without working storage does.
 */
function memoryStore(initial: Record<string, string>, fail: { get?: boolean; set?: boolean; remove?: boolean } = {}) {
  const values = new Map(Object.entries(initial));
  const store: KeyValueStore = {
    async get(key) {
      if (fail.get) throw new Error('storage unavailable');
      return values.get(key) ?? null;
    },
    async set(key, value) {
      if (fail.set) throw new Error('storage unavailable');
      values.set(key, value);
    },
    async remove(key) {
      if (fail.remove) throw new Error('storage unavailable');
      values.delete(key);
    },
  };
  return { store, values };
}

const legacyEntry = (fields: Record<string, unknown>) => JSON.stringify({ ...fields, password: FAKE_PASSWORD });

/** The password is never copied: no value holds it, apart from a legacy entry that could not go. */
function assertPasswordNotCopied(values: Map<string, string>) {
  for (const [key, value] of values) {
    if (key === LEGACY_CREDENTIALS_KEY) continue;
    assert.equal(value.includes(FAKE_PASSWORD), false, `${key} holds the password`);
  }
}

test('the upgrade keeps the address of a legacy entry and deletes the entry', async () => {
  const { store, values } = memoryStore({ [LEGACY_CREDENTIALS_KEY]: legacyEntry({ email: ' someone@example.invalid ' }) });
  await migrateLegacyEntry(store);

  assert.equal(values.has(LEGACY_CREDENTIALS_KEY), false, 'the legacy entry with the password is still stored');
  assert.equal(values.get(SAVED_EMAIL_KEY), 'someone@example.invalid');
  assert.deepEqual([...values.keys()], [SAVED_EMAIL_KEY]);
  assertPasswordNotCopied(values);
});

test('the upgrade deletes a legacy entry that is malformed or has no address', async () => {
  for (const raw of ['not json', '', 'null', '[]', legacyEntry({}), legacyEntry({ email: 42 }), legacyEntry({ email: '   ' })]) {
    const { store, values } = memoryStore({ [LEGACY_CREDENTIALS_KEY]: raw });
    await migrateLegacyEntry(store);

    assert.equal(values.has(LEGACY_CREDENTIALS_KEY), false, `legacy entry ${JSON.stringify(raw)} is still stored`);
    assert.equal(values.has(SAVED_EMAIL_KEY), false, `an address was saved from ${JSON.stringify(raw)}`);
  }
});

test('the upgrade does not overwrite an address saved by the new version', async () => {
  const { store, values } = memoryStore({
    [LEGACY_CREDENTIALS_KEY]: legacyEntry({ email: 'older@example.invalid' }),
    [SAVED_EMAIL_KEY]: 'newer@example.invalid',
  });
  await migrateLegacyEntry(store);

  assert.equal(values.has(LEGACY_CREDENTIALS_KEY), false, 'the legacy entry is still stored');
  assert.equal(values.get(SAVED_EMAIL_KEY), 'newer@example.invalid');
  assertPasswordNotCopied(values);
});

test('the legacy entry is deleted even when the address cannot be kept', async () => {
  const { store, values } = memoryStore({ [LEGACY_CREDENTIALS_KEY]: legacyEntry({ email: 'someone@example.invalid' }) }, { set: true });
  await migrateLegacyEntry(store);

  assert.equal(values.has(LEGACY_CREDENTIALS_KEY), false, 'the legacy entry is still stored');
  assert.equal(values.has(SAVED_EMAIL_KEY), false);
});

test('without a legacy entry the upgrade changes nothing', async () => {
  const { store, values } = memoryStore({ [SAVED_EMAIL_KEY]: 'someone@example.invalid' });
  await migrateLegacyEntry(store);

  assert.deepEqual([...values], [[SAVED_EMAIL_KEY, 'someone@example.invalid']]);
});

test('a storage error never stops the app start', async () => {
  // Reading fails: nothing can be done now; the entry is read again on the next start.
  const unreadable = memoryStore({ [LEGACY_CREDENTIALS_KEY]: legacyEntry({ email: 'someone@example.invalid' }) }, { get: true });
  await assert.doesNotReject(migrateLegacyEntry(unreadable.store));
  assert.equal(unreadable.values.has(SAVED_EMAIL_KEY), false);
  assertPasswordNotCopied(unreadable.values);

  // Deleting fails: the call still resolves, the address is kept, and the password is not copied.
  const locked = memoryStore({ [LEGACY_CREDENTIALS_KEY]: legacyEntry({ email: 'someone@example.invalid' }) }, { remove: true });
  await assert.doesNotReject(migrateLegacyEntry(locked.store));
  assert.equal(locked.values.get(SAVED_EMAIL_KEY), 'someone@example.invalid');
  assertPasswordNotCopied(locked.values);

  // Everything fails.
  const broken = memoryStore({ [LEGACY_CREDENTIALS_KEY]: legacyEntry({ email: 'someone@example.invalid' }) }, { get: true, set: true, remove: true });
  await assert.doesNotReject(migrateLegacyEntry(broken.store));
});
