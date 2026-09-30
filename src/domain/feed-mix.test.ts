import test from 'node:test';
import assert from 'node:assert/strict';

import { mixFeed, type MixableActivity } from './feed-mix.ts';

const post = (id: number): MixableActivity => ({ id, is_permanent: false });
const ever = (id: number): MixableActivity => ({ id, is_permanent: true });

function shape(items: ReturnType<typeof mixFeed>) {
  return items.map((i) => (i.kind === 'post' ? `p${i.activity.id}` : `[${i.activities.map((a) => a.id).join(',')}]`));
}

test('Beiträge behalten ihre Reihenfolge, der erste Block kommt nach zwei Beiträgen', () => {
  const feed = mixFeed([post(1), post(2), post(3), ever(10)], { firstAt: 2, every: 4, perBlock: 4 });
  assert.deepEqual(shape(feed), ['p1', 'p2', '[10]', 'p3']);
});

test('Danach alle `every` Beiträge ein Block, reihum mit den nächsten Dauerangeboten', () => {
  const ranked = [ever(10), ever(11), ever(12), ...[1, 2, 3, 4, 5, 6].map(post)];
  const feed = mixFeed(ranked, { firstAt: 2, every: 4, perBlock: 2 });
  assert.deepEqual(shape(feed), ['p1', 'p2', '[10,11]', 'p3', 'p4', 'p5', 'p6', '[12,10]']);
});

test('Jedes Dauerangebot höchstens zweimal im Feed', () => {
  const ranked = [ever(10), ...Array.from({ length: 40 }, (_, i) => post(i + 1))];
  const feed = mixFeed(ranked, { firstAt: 2, every: 4, perBlock: 4 });
  const shown = feed.filter((i) => i.kind === 'evergreen').flatMap((i) => (i.kind === 'evergreen' ? i.activities : []));
  assert.equal(shown.length, 2);
});

test('Weniger Beiträge als bis zum ersten Block: Block steht am Ende', () => {
  const feed = mixFeed([post(1), ever(10), ever(11)], { firstAt: 3 });
  assert.deepEqual(shape(feed), ['p1', '[10,11]']);
});

test('Ohne Beiträge werden die Dauerangebote selbst zum Feed', () => {
  const feed = mixFeed([ever(10), ever(11)]);
  assert.deepEqual(shape(feed), ['p10', 'p11']);
});

test('Ohne Dauerangebote bleibt der Feed unverändert', () => {
  const feed = mixFeed([post(1), post(2), post(3)]);
  assert.deepEqual(shape(feed), ['p1', 'p2', 'p3']);
});

test('Schlüssel sind eindeutig', () => {
  const ranked = [ever(10), ever(11), ...Array.from({ length: 12 }, (_, i) => post(i + 1))];
  const keys = mixFeed(ranked, { perBlock: 1 }).map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
});
