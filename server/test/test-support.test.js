/**
 * Tests for the shared fixtures (test/support/fixtures.js) - no database needed.
 *
 * The stamp check is structural, not a sample: a stamp can only trip the word filter if the
 * leet reading of its digits completes a blocked term that the prefix started (or forms one on
 * its own). So for every username term and every way to split it into "end of the prefix" plus
 * "start of the stamp", the stamp part is written in SAFE_DIGITS where that is possible at all,
 * appended to every prefix the tests use, and the real filter decides. One hit = some stamp can
 * produce that username.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { BLOCKED_TERMS, findBlockedTerm, termTokens } from '../src/blocked-terms.js';
import { SAFE_DIGITS, STAMP_LENGTH, testIdentity, uniqueStamp } from './support/fixtures.js';

const TEST_DIR = new URL('./', import.meta.url);
/** The deploy tests: the stack test registers accounts through the running stack. */
const DEPLOY_TEST_DIR = new URL('../../deploy/test/', import.meta.url);
const STACK_TEST = new URL('stack.test.mjs', DEPLOY_TEST_DIR);

/** The server test files and their text. */
function testFiles() {
  return fs
    .readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => ({ name, text: fs.readFileSync(new URL(name, TEST_DIR), 'utf8') }));
}

/** Every literal username prefix the server tests put in front of a stamp. */
function usernamePrefixes() {
  const prefixes = new Set();
  for (const { text } of testFiles()) {
    for (const m of text.matchAll(/\b(?:registerUser|tryRegister|insertTestUser|testIdentity|createUser)\((?:pool, )?'([a-z0-9]+)'/g)) {
      prefixes.add(m[1]);
    }
    for (const m of text.matchAll(/`([a-z0-9]+)\$\{(?:s|stamp|stamp\(\)|uniqueStamp\(\))\}/g)) prefixes.add(m[1]);
  }
  return [...prefixes];
}

/**
 * The deploy tests (deploy/test/*.mjs; the stack test registers accounts through the running
 * stack): their text, and every username prefix they hand to testIdentity(). They take their
 * stamps from these fixtures, so there is no second stamp rule to compare.
 */
function deployTests() {
  const files = fs
    .readdirSync(DEPLOY_TEST_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => ({ name, text: fs.readFileSync(new URL(name, DEPLOY_TEST_DIR), 'utf8') }));
  const prefixes = files.flatMap(({ text }) => [...text.matchAll(/\btestIdentity\('([a-z0-9]+)'/g)].map((m) => m[1]));
  return { files, prefixes };
}

/**
 * Usernames `<prefix><digits>` that could start a username built from a stamp over `digits` and
 * that the filter blocks. Returns the blocked ones (prefix + digit tail, term group and kind only)
 * and how many candidates were checked.
 */
function stampRisks(prefixes, digits) {
  const table = BLOCKED_TERMS.normalize;
  // Character in a term -> digit that produces it: a digit stands for itself in the plain reading
  // and for its leet letter in the leet readings.
  const producer = new Map();
  for (const d of digits) {
    producer.set(d, d);
    const letter = table.leet[d];
    if (letter && !producer.has(letter)) producer.set(letter, d);
  }
  const tails = new Set();
  for (const group of BLOCKED_TERMS.groups) {
    if (!(group.modes ?? []).includes('username')) continue;
    for (const kind of ['substring', 'prefix', 'word']) {
      for (const term of group[kind] ?? []) {
        const chars = termTokens(term, table).join('');
        for (let k = 0; k < chars.length; k += 1) {
          const rest = [...chars.slice(k)];
          if (rest.every((c) => producer.has(c))) tails.add(rest.map((c) => producer.get(c)).join(''));
        }
      }
    }
  }
  const blocked = [];
  let checked = 0;
  for (const prefix of prefixes) {
    for (const tail of tails) {
      checked += 1;
      const hit = findBlockedTerm(`${prefix}${tail}`, BLOCKED_TERMS, 'username');
      if (hit) blocked.push(`${prefix} + ${tail} (${hit.group}/${hit.kind})`);
    }
  }
  return { blocked, checked, tails: tails.size };
}

test('uniqueStamp: only SAFE_DIGITS, fixed length, and no two alike in a run-sized sample', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const stamp = uniqueStamp();
    assert.equal(stamp.length, STAMP_LENGTH);
    assert.match(stamp, new RegExp(`^[${SAFE_DIGITS}]+$`));
    seen.add(stamp);
  }
  assert.equal(seen.size, 2000);
});

test('testIdentity: username fits the 28-character slice, address uses the reserved test domain', () => {
  const id = testIdentity('adminstoryoldadm');
  assert.equal(id.username, `adminstoryoldadm${id.stamp}`);
  assert.ok(id.username.length <= 28);
  assert.match(id.email, /^adminstoryoldadm[0-9]+@example\.invalid$/);
});

test('no stamp can make the word filter block a username the server tests build', () => {
  const prefixes = usernamePrefixes();
  // Denominator: the scan must have found the prefixes, or it proves nothing.
  assert.ok(prefixes.length >= 100, `only ${prefixes.length} username prefixes found in test/*.test.js`);
  for (const prefix of prefixes) {
    assert.equal(findBlockedTerm(prefix, BLOCKED_TERMS, 'username'), null, `prefix ${prefix} is blocked by itself`);
  }
  const { blocked, checked, tails } = stampRisks(prefixes, SAFE_DIGITS);
  assert.ok(checked > 0 && tails > 0, 'no candidate usernames were checked');
  assert.deepEqual(blocked, [], `${blocked.length} of ${checked} candidate usernames are blocked`);
});

test('control: the same check finds blocked usernames when stamps may use every digit', () => {
  // Proves the check above can fail: with 1/4/8 a stamp can form a numeric code, with 9 the
  // leet reading completes a term after one of today's prefixes.
  const { blocked, checked } = stampRisks(['probe', 'zfadel2fa'], '0123456789');
  assert.ok(checked > 0);
  assert.ok(blocked.some((b) => b.startsWith('probe + ')), 'a numeric code after a neutral prefix');
  assert.ok(blocked.some((b) => b.startsWith('zfadel2fa + ')), 'a leet completion after a test prefix');
});

test('stack test: takes its usernames and stamps from these fixtures, with no stamp rule of its own', () => {
  const { files } = deployTests();
  assert.ok(files.length > 0, 'no deploy test file found in deploy/test/');
  const stack = fs.readFileSync(STACK_TEST, 'utf8');
  assert.match(stack, /import \{[^}]*\btestIdentity\b[^}]*\} from '\.\.\/\.\.\/server\/test\/support\/fixtures\.js';/,
    'deploy/test/stack.test.mjs must import testIdentity from server/test/support/fixtures.js');
  // A stamp of its own (the clock, Math.random, a shell date) could form a blocked code again.
  const sites = [];
  for (const { name, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (/Date\.now\(\)\}|Math\.random\(\)|date \+%s/.test(line) && /user(name)?|stamp/i.test(line)) sites.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(sites, [], 'use testIdentity() or uniqueStamp() from test/support/fixtures.js');
});

test('stack test: no stamp can make the word filter block a username it registers', () => {
  const { prefixes } = deployTests();
  // The stack test also registers one username that is blocked by itself, to see the filter answer
  // 422; it is built from a term of the list, not with testIdentity(), and is not an account.
  const accounts = [...new Set(prefixes)].filter((p) => findBlockedTerm(p, BLOCKED_TERMS, 'username') === null);
  assert.ok(accounts.length > 0, `no account username prefix found in deploy/test/ (${prefixes.length} prefixes, all blocked)`);
  assert.equal(accounts.length, new Set(prefixes).size, 'a testIdentity() prefix in deploy/test/ is blocked by itself');
  const { blocked, checked, tails } = stampRisks(accounts, SAFE_DIGITS);
  assert.ok(checked > 0 && tails > 0, 'no candidate usernames were checked');
  assert.deepEqual(blocked, [], `${blocked.length} of ${checked} candidate stack test usernames are blocked`);
});

test('every numeric run in the blocked terms contains a digit that stamps never use', () => {
  const runs = [];
  for (const group of BLOCKED_TERMS.groups) {
    for (const kind of ['substring', 'prefix', 'word']) {
      for (const term of group[kind] ?? []) runs.push(...(String(term).match(/[0-9]+/g) ?? []));
    }
  }
  assert.ok(runs.length > 0, 'no numeric terms found - the list format changed?');
  const unsafe = runs.filter((run) => [...run].every((d) => SAFE_DIGITS.includes(d)));
  assert.deepEqual(unsafe, []);
});

test('no server test builds username stamps from Date.now() and Math.random()', () => {
  const files = testFiles();
  assert.ok(files.length > 0);
  const sites = [];
  for (const { name, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (/\$\{Date\.now\(\)\}\$\{Math\.floor\(Math\.random\(\)/.test(line)) sites.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(sites, [], 'use uniqueStamp() from test/support/fixtures.js');
});
