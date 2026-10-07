import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static check (F-02): the app checks e-mail addresses only through src/domain/email.ts, which
 * caps the length and runs in linear time. A screen with its own copy of the former pattern
 * would freeze on a pasted long text and accept addresses the server refuses.
 */
const SRC = path.resolve(import.meta.dirname, '..');
const FORMER_PATTERN_PART = '[^\\s@]+@';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

test('no source file outside src/domain/email.ts keeps its own e-mail pattern', () => {
  const files = sourceFiles(SRC).filter((file) => path.relative(SRC, file) !== path.join('domain', 'email.ts'));
  const copies = files
    .filter((file) => readFileSync(file, 'utf8').includes(FORMER_PATTERN_PART))
    .map((file) => path.relative(SRC, file));

  assert.ok(files.length > 100, `only ${files.length} source files scanned`);
  assert.deepEqual(copies, [], `${files.length} files scanned`);
});

test('the e-mail address changes only on its own screen, with the password (F-04)', () => {
  const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');
  const api = read('lib/api.ts');
  const profileInput = api.slice(api.indexOf('export type UpdateProfileInput'), api.indexOf('};', api.indexOf('export type UpdateProfileInput')));
  assert.doesNotMatch(profileInput, /\bemail\??:/, 'UpdateProfileInput still carries the e-mail address');
  assert.match(api, /changeEmail: \(token: string, input: \{ email: string; current_password: string; code\?: string \}\)/);
  assert.match(api, /'\/user\/email', \{ method: 'PUT'/);

  const settings = read('app/settings.tsx');
  assert.doesNotMatch(settings, /field="email"/, 'the settings still edit the e-mail address inline');
  assert.match(settings, /router\.push\('\/security\/email'\)/);

  const screen = read('app/security/email.tsx');
  assert.match(screen, /api\.changeEmail\(/);
  assert.match(screen, /current_password: password/);

  const layout = read('app/_layout.tsx');
  const guarded = layout.slice(layout.indexOf('<Stack.Protected guard={!!token}>'), layout.indexOf('</Stack.Protected>'));
  assert.match(guarded, /<Stack\.Screen name="security\/email" \/>/);
});

test('the sign-up and forgot-password screens use the shared check', () => {
  for (const screen of ['app/(auth)/register.tsx', 'app/(auth)/forgot-password.tsx']) {
    const text = readFileSync(path.join(SRC, screen), 'utf8');
    assert.match(text, /from '@\/domain\/email'/, `${screen} imports src/domain/email.ts`);
    assert.match(text, /isEmailAddress\(/, `${screen} calls isEmailAddress`);
  }
});
