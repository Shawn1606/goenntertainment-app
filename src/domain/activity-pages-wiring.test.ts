import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Static checks of the event-list wiring (F-12). The paging logic is tested in
 * activity-pages.test.ts; these checks prove that the app uses it: the one call of the list goes
 * through collectPages, every screen that loads events is listed with the events it asks for, and
 * the screens that show your history ask for it explicitly. They read the source, so they cannot
 * show the rendered screens; that part is a manual check (more than 100 upcoming events: the feed,
 * the map and the search show all of them; the profile shows your past events).
 */
const SRC = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

/** The code without comments, so a comment that explains the old behaviour cannot match. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** Every .ts/.tsx file under src/ except tests, relative to src/. */
function sourceFiles(dir = SRC): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(path.relative(SRC, full).split(path.sep).join('/'));
    }
  }
  return files;
}

/**
 * Every place that loads the event list, with what it asks for: `{}` the upcoming events,
 * `mine` only your own upcoming ones, `past` your own past ones.
 */
const CALLERS: Record<string, string[]> = {
  'app/(app)/index.tsx': ['', '{ past: true }'],
  'app/(app)/me.tsx': ['{ mine: true }', '{ past: true }'],
  'app/(app)/create.tsx': ['{ mine: true }'],
  'app/search.tsx': [''],
  'app/admin-dashboard.tsx': [''],
  'lib/use-map-activities.ts': [''],
};

/** The query object of each `api.activities(token…)` call in `text` ('' without one). */
function listCalls(text: string): string[] {
  return [...text.matchAll(/\.activities\(\s*token\s*(?:,\s*(\{[^}]*\}))?\s*\)/g)].map((m) => m[1] ?? '');
}

test('the event list is loaded through collectPages, page by page', () => {
  const api = code('lib/api.ts');
  const start = api.search(/\n {2}activities: /);
  assert.ok(start >= 0, 'src/lib/api.ts has no activities()');
  const member = api.slice(start, api.indexOf('\n  }),', start));
  assert.match(member, /collectPages\(\(cursor\) =>/, 'api.activities() does not follow next_cursor');
  assert.match(member, /request<ActivityPage<Activity>>\(activityListPath\(query, cursor\), \{ token \}\)/);
  // No other request reads the list in one go.
  assert.doesNotMatch(api, /request<[^>]*>\(\s*['`]\/activities['`?]/, 'a request for the bare list path');
  assert.doesNotMatch(api, /['`]\/activities\?/, 'a list query built outside activityListPath');
});

test('every screen that loads events is listed, with the events it asks for', () => {
  const found: Record<string, string[]> = {};
  for (const file of sourceFiles()) {
    if (file === 'lib/api.ts') continue;
    const calls = listCalls(code(file));
    if (calls.length > 0) found[file] = calls;
  }
  // Denominator: the six places that load the list.
  assert.equal(Object.keys(found).length, Object.keys(CALLERS).length, `callers found: ${Object.keys(found).join(', ')}`);
  assert.deepEqual(found, CALLERS);
});

test('no screen fetches the event list past api.activities()', () => {
  // The two files that may: the API module and the path builder it uses.
  const allowed = ['lib/api.ts', 'domain/activity-pages.ts'];
  const files = sourceFiles();
  assert.ok(files.length >= 100, `only ${files.length} source files found`);
  const direct = files
    .filter((file) => !allowed.includes(file))
    .filter((file) => /['`"]\/activities['`"?]|\/activities\?/.test(code(file)));
  assert.deepEqual(direct, []);
});

test('the profile shows your past events through past=1, merged with your upcoming ones', () => {
  const me = code('app/(app)/me.tsx');
  assert.match(me, /setActivities\(mergeById\(upcoming\.data, past\.data\)\)/);
});

test("the feed's suggestions still know the events you were at", () => {
  const feed = code('app/(app)/index.tsx');
  assert.match(feed, /if \(past\) setPastOwn\(past\.data\);/);
  assert.match(feed, /attendedInterestIds: \[\.\.\.activities, \.\.\.pastOwn\]/);
});
