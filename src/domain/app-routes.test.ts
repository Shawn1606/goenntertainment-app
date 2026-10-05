import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static checks of the screen setup (F-05/F-18): the legacy admin screen with its own sign-in and
 * a hard-coded admin address is gone, and every admin screen sits behind the signed-in guard
 * (the server checks admin rights on every admin route; these screens only show what it allows).
 * A profile shows the ADMIN badge only on the own profile.
 *
 * Failure messages name files only, never a matched value.
 */
const SRC = path.resolve(import.meta.dirname, '..');
const LAYOUT = path.join(SRC, 'app', '_layout.tsx');

/** An e-mail-like string literal ('…', "…" or `…`). */
const EMAIL_LITERAL = /(['"`])[^'"`\s]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\1/;

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full, pattern);
    return pattern.test(entry.name) ? [full] : [];
  });
}

/** The source between `<Stack.Protected guard={!!token}>` and its closing tag. */
function signedInBlock(layout: string): string {
  const start = layout.indexOf('<Stack.Protected guard={!!token}>');
  assert.ok(start >= 0, 'the signed-in guard is not in _layout.tsx');
  const end = layout.indexOf('</Stack.Protected>', start);
  assert.ok(end > start, 'the signed-in guard is not closed');
  return layout.slice(start, end);
}

test('the legacy /admin screen is gone', () => {
  assert.equal(existsSync(path.join(SRC, 'app', 'admin.tsx')), false, 'src/app/admin.tsx still exists');
  assert.doesNotMatch(readFileSync(LAYOUT, 'utf8'), /<Stack\.Screen\s+name="admin"\s*\/>/);
});

test('every admin screen is registered inside the signed-in guard', () => {
  const screens = readdirSync(path.join(SRC, 'app'))
    .filter((name) => /^admin(-[a-z]+)?\.tsx$/.test(name))
    .map((name) => name.replace(/\.tsx$/, ''));
  const layout = readFileSync(LAYOUT, 'utf8');
  const guarded = signedInBlock(layout);

  // Denominator: the admin screens that exist (seven at the time of writing).
  assert.ok(screens.length >= 7, `only ${screens.length} admin screens found`);
  for (const screen of screens) {
    assert.match(guarded, new RegExp(`<Stack\\.Screen name="${screen}"`), `${screen} is not inside the signed-in guard`);
  }
  const outside = layout.replace(guarded, '');
  assert.doesNotMatch(outside, /<Stack\.Screen name="admin/, 'an admin screen is registered outside the signed-in guard');
});

test('a profile shows the ADMIN badge only through showsAdminBadge, so only on the own profile (F-05)', () => {
  const scanned = [...files(path.join(SRC, 'app'), /\.tsx?$/), ...files(path.join(SRC, 'components'), /\.tsx?$/)];
  const direct = scanned.filter((file) => /\bprofile\.user\.is_admin\b/.test(readFileSync(file, 'utf8')));

  assert.ok(scanned.length > 50, `only ${scanned.length} files scanned`);
  assert.deepEqual(
    direct.map((file) => path.relative(SRC, file)),
    [],
    `${scanned.length} files scanned; a profile's is_admin is read only through showsAdminBadge`,
  );
  const screen = readFileSync(path.join(SRC, 'app', 'profile', '[username].tsx'), 'utf8');
  assert.match(screen, /\{showsAdminBadge\(profile\) \? \(/, 'the profile screen does not decide the badge with showsAdminBadge');
});

test('no screen, component or helper compares with a hard-coded e-mail address', () => {
  const scanned = [
    ...files(path.join(SRC, 'app'), /\.tsx?$/),
    ...files(path.join(SRC, 'components'), /\.tsx?$/),
    ...files(path.join(SRC, 'lib'), /\.tsx?$/),
  ];
  const offenders = scanned.filter((file) => {
    // Input placeholders show an example address and decide nothing.
    const text = readFileSync(file, 'utf8').replace(/placeholder=(['"])[^'"]*\1/g, 'placeholder=""');
    return EMAIL_LITERAL.test(text);
  });

  assert.ok(scanned.length > 50, `only ${scanned.length} files scanned`);
  assert.deepEqual(
    offenders.map((file) => path.relative(SRC, file)),
    [],
    `${scanned.length} files scanned; an address in code belongs in configuration, never in an access check`,
  );
});
