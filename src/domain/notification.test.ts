import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isUiIconName } from './ui-icon.ts';
import { NOTIFICATION_TYPES, notificationIcon, notificationTarget } from './notification.ts';

/** Kurzform für eine Test-Benachrichtigung. */
function note(type: string, options: { ref?: number | null; actor?: string | null } = {}) {
  return {
    type,
    ref_id: options.ref === undefined ? 1 : options.ref,
    actor: options.actor === null ? null : { username: options.actor ?? 'anna' },
  };
}

const me = { username: 'ich' };

test('jede bekannte Sorte hat ein Symbol, das es wirklich gibt', () => {
  // Sonst zeichnet die Liste ein Symbol, das die Icon-Tabelle nicht kennt.
  for (const type of NOTIFICATION_TYPES) {
    assert.ok(isUiIconName(notificationIcon(type)), `kein Symbol für ${type}`);
  }
});

test('eine unbekannte Sorte bekommt die Glocke statt eines Absturzes', () => {
  // Ein neuerer Server darf eine Sorte mehr schicken.
  assert.equal(notificationIcon('etwas-neues'), 'bell');
  assert.ok(isUiIconName(notificationIcon('etwas-neues')));
});

test('eine Story führt auf die Startseite – eine Story-Adresse gibt es nicht', () => {
  assert.deepEqual(notificationTarget(note('story'), me), { kind: 'home' });
});

test('ein Event führt auf das Event', () => {
  assert.deepEqual(notificationTarget(note('activity', { ref: 42 }), me), {
    kind: 'activity',
    id: 42,
  });
});

test('ein Event ohne Kennung ist nicht antippbar statt ins Leere zu führen', () => {
  assert.equal(notificationTarget(note('activity', { ref: null }), me), null);
});

test('Beitrag und Folgen führen auf das Profil der auslösenden Person', () => {
  assert.deepEqual(notificationTarget(note('post'), me), { kind: 'profile', username: 'anna' });
  assert.deepEqual(notificationTarget(note('follow'), me), { kind: 'profile', username: 'anna' });
});

test('Like und Kommentar führen auf das EIGENE Profil – dort steht der Beitrag', () => {
  assert.deepEqual(notificationTarget(note('like'), me), { kind: 'profile', username: 'ich' });
  assert.deepEqual(notificationTarget(note('comment'), me), { kind: 'profile', username: 'ich' });
});

test('ohne Benutzernamen gibt es kein Ziel statt eines toten Tipps', () => {
  assert.equal(notificationTarget(note('post', { actor: null }), me), null);
  // Ein Like zeigt auf MEIN Profil – ohne eigenen Benutzernamen also nirgendwo hin.
  assert.equal(notificationTarget(note('like'), { username: null }), null);
});

test('wer selbst keinen Benutzernamen hat, kommt trotzdem auf fremde Profile', () => {
  // „folgt dir" zeigt auf die andere Person – der eigene Name spielt keine Rolle.
  assert.deepEqual(notificationTarget(note('follow'), null), {
    kind: 'profile',
    username: 'anna',
  });
});

test('eine unbekannte Sorte ist nicht antippbar', () => {
  assert.equal(notificationTarget(note('etwas-neues'), me), null);
});

// Der Zähler an der Glocke wird in `unread-badge.test.ts` geprüft – es ist
// derselbe wie der an einem Chat.

test('a comment on my event leads to the event and shows the chat icon (F-08)', () => {
  assert.deepEqual(notificationTarget(note('activity_comment', { ref: 42 }), me), { kind: 'activity', id: 42 });
  assert.equal(notificationTarget(note('activity_comment', { ref: null }), me), null);
  assert.equal(notificationIcon('activity_comment'), 'chat');
  assert.ok((NOTIFICATION_TYPES as readonly string[]).includes('activity_comment'), 'the app does not know the type');
});
