import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { commentsLabel, formatCount, likesLabel, participantsSentence, toggledLike } from './activity-social.ts';
// Newer rules through the namespace: this file still loads where they are missing, and their tests
// then fail on an assertion.
import * as social from './activity-social.ts';

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

/* --------------------------------------------- deleting a comment after a block (F-13) */

test('a 404 to deleting a comment means the comment is gone: no error, it leaves the list', () => {
  assert.equal(typeof social.commentGoneAfterDeleteError, 'function', 'no rule for a failed comment deletion');
  // The server deletes one's own comment first and then hides the other person's post (404).
  assert.equal(social.commentGoneAfterDeleteError(404), true);
  for (const status of [400, 401, 403, 422, 429, 500, undefined]) {
    assert.equal(social.commentGoneAfterDeleteError(status), false, `${status} is a real failure`);
  }
});

test('the post card removes a comment whose deletion answered 404, without an error', () => {
  // Static check of the wiring (the rendered card is a manual check): the catch of
  // onDeleteComment asks the rule and filters the comment out before any error is shown.
  const card = readFileSync(path.resolve(import.meta.dirname, '..', 'components', 'profile-post-card.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const start = card.indexOf('async function onDeleteComment(');
  assert.ok(start >= 0, 'onDeleteComment not found in profile-post-card.tsx');
  const handler = card.slice(start, card.indexOf('\n  }\n', start));
  const caught = handler.slice(handler.indexOf('} catch (err) {'));
  assert.match(
    caught,
    /if \(err instanceof ApiError && commentGoneAfterDeleteError\(err\.status\)\) \{\s*setComments\(\(current\) => \(current \?\? \[\]\)\.filter\(\(row\) => row\.id !== comment\.id\)\);\s*return;\s*\}/,
    'a 404 to deleting a comment still shows an error',
  );
  assert.ok(caught.indexOf('commentGoneAfterDeleteError') < caught.indexOf('setError('), 'the error is shown before the 404 is handled');
});
