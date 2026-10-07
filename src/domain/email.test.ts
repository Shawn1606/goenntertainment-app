import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMAIL_MAX_LENGTH, isEmailAddress } from './email.ts';

/** The pattern the app used before (sign-up and forgot password). */
const FORMER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Small seeded generator, so every run checks the same strings. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 0x100000000;
  };
}

test('agrees with the former pattern on 20,000 short strings', () => {
  const random = seeded(20261002);
  const pick = (from: string[]) => from[Math.floor(random() * from.length)];
  const alphabet = ['a', 'b', 'x', '@', '.', ' ', '\t', '\n', '\v', '\f', '\r', ' ', ' ', 'ü', '-'];
  const letters = ['a', 'b', 'x', 'ü', '-'];
  const word = (min: number, max: number) => {
    let s = '';
    for (let n = min + Math.floor(random() * (max - min + 1)); n > 0; n -= 1) s += pick(letters);
    return s;
  };

  let checked = 0;
  let accepted = 0;
  for (let i = 0; i < 20000; i += 1) {
    let s = '';
    if (i % 2 === 0) {
      for (let j = Math.floor(random() * 17); j > 0; j -= 1) s += pick(alphabet);
    } else {
      s = `${word(0, 4)}@${word(0, 4)}.${word(0, 3)}`;
      for (let edits = Math.floor(random() * 3); edits > 0; edits -= 1) {
        const at = Math.floor(random() * (s.length + 1));
        s = s.slice(0, at) + pick(alphabet) + s.slice(at + Math.floor(random() * 2));
      }
    }
    const expected = FORMER.test(s);
    assert.equal(isEmailAddress(s), expected, `disagrees on ${JSON.stringify(s)}`);
    checked += 1;
    if (expected) accepted += 1;
  }

  // Denominator: both outcomes must occur, or the comparison proves nothing.
  assert.equal(checked, 20000);
  assert.ok(accepted > 100, `only ${accepted} accepted`);
  assert.ok(accepted < checked - 100, `${accepted} of ${checked} accepted`);
});

test('known cases', () => {
  for (const ok of ['a@b.c', 'first.last@example.invalid', 'a.b@c.d.e', 'ü@ü.example.invalid', 'a@b..c', 'a@.b.c']) {
    assert.equal(isEmailAddress(ok), true, ok);
  }
  for (const bad of ['', 'a', '@b.c', 'a@', 'a@b', 'a@b.', 'a@.b', 'a@@b.c', 'a@b@c.d', 'a b@c.d', 'a@b.c\n', null, 42]) {
    assert.equal(isEmailAddress(bad), false, JSON.stringify(bad));
  }
});

test('the length cap is 254 characters, the same as the server', () => {
  assert.equal(EMAIL_MAX_LENGTH, 254);
  const address = (total: number) => `${'a'.repeat(total - '@example.invalid'.length)}@example.invalid`;
  assert.equal(address(254).length, 254);
  assert.equal(isEmailAddress(address(254)), true);
  assert.equal(isEmailAddress(address(255)), false);
  assert.equal(FORMER.test(address(255)), true, 'the former pattern had no cap');
});

test('100,000-character inputs are rejected fast', () => {
  const inputs: Record<string, string> = {
    'long local part': `${'a'.repeat(100000)}@example.invalid`,
    'many dots in the domain, trailing blank': `a@${'b.'.repeat(50000)} `,
    'only at signs': '@'.repeat(100000),
    'no at sign': 'x'.repeat(100000),
  };
  for (const [shape, input] of Object.entries(inputs)) {
    const start = performance.now();
    const valid = isEmailAddress(input);
    const ms = performance.now() - start;
    assert.equal(valid, false, shape);
    // Generous bound (the check takes well under a millisecond): a slow runner never flakes.
    assert.ok(ms < 200, `${shape}: ${ms} ms`);
  }
});
