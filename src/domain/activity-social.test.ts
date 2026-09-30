import test from 'node:test';
import assert from 'node:assert/strict';

import { commentsLabel, formatCount, likesLabel, participantsSentence, toggledLike } from './activity-social.ts';

test('toggledLike schaltet um und zählt mit', () => {
  assert.deepEqual(toggledLike({ likes_count: 3, liked_by_me: false }), { likes_count: 4, liked_by_me: true });
  assert.deepEqual(toggledLike({ likes_count: 4, liked_by_me: true }), { likes_count: 3, liked_by_me: false });
});

test('toggledLike kommt mit fehlenden Feldern (älterer Server) zurecht und wird nie negativ', () => {
  assert.deepEqual(toggledLike({}), { likes_count: 1, liked_by_me: true });
  assert.deepEqual(toggledLike({ likes_count: 0, liked_by_me: true }), { likes_count: 0, liked_by_me: false });
});

test('likesLabel und commentsLabel schweigen bei null', () => {
  assert.equal(likesLabel(0), null);
  assert.equal(likesLabel(undefined), null);
  assert.equal(likesLabel(12), '12 Gefällt mir');
  assert.equal(commentsLabel(0), null);
  assert.equal(commentsLabel(1), '1 Kommentar ansehen');
  assert.equal(commentsLabel(4), 'Alle 4 Kommentare ansehen');
});

test('formatCount kürzt große Zahlen deutsch', () => {
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1200), '1,2 Tsd.');
  assert.equal(formatCount(25_400), '25 Tsd.');
});

test('participantsSentence', () => {
  assert.equal(participantsSentence([]), null);
  assert.equal(participantsSentence(['Anna']), 'Anna ist dabei');
  assert.equal(participantsSentence(['Anna', 'Ben']), 'Anna und Ben sind dabei');
  assert.equal(participantsSentence(['Anna', 'Ben', 'Cem'], 7), 'Anna, Ben und 5 weitere sind dabei');
  assert.equal(participantsSentence(['Anna', 'Ben', 'Cem']), 'Anna, Ben und 1 weitere Person sind dabei');
  assert.equal(participantsSentence([], 4), '4 Personen sind dabei');
});
