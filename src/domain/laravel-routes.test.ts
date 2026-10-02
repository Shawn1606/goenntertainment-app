import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * The app's calls that only Laravel answers (F-10): two-factor sign-in and setup, the password
 * change and the e-mail change. Node no longer has a copy of these routes (one owner per path),
 * so a call whose path or method Laravel does not know falls through to Node and gets a 404 in
 * production. This test reads the calls from src/lib/api.ts and the routes from
 * api/routes/api.php and checks that each call is a Laravel route. The deploy's stack test
 * (deploy/test/stack.test.mjs) then shows that every Laravel route reaches Laravel through the
 * edge. Files are read as text; nothing runs.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

type Call = { method: string; path: string; line: number };

/**
 * The index just after the string that starts with the quote at `start`: escapes skipped, and in
 * a template the `${...}` parts, whatever quotes and braces they hold.
 */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === quote) return i + 1;
    else if (quote === '`' && text[i] === '$' && text[i + 1] === '{') i = closing(text, i + 1) - 1;
  }
  throw new Error(`no end for the string at ${start}`);
}

/** The index just after the bracket that closes the one at `open` (strings and comments skipped). */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i = stringEnd(text, i) - 1;
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) break;
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      if (i <= 0) break;
    } else if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  throw new Error(`no closing bracket for the one at ${open}`);
}

/**
 * Every `request<...>('/path', { method: ... })` of src/lib/api.ts (GET when none is given), and
 * every other `request<...>(` it found (the function's own definition), so none goes unseen.
 */
function clientCalls(text: string): { calls: Call[]; other: string[] } {
  const calls: Call[] = [];
  const other: string[] = [];
  for (const m of text.matchAll(/\brequest</g)) {
    // The end of the type argument: angle brackets nest (an arrow's `=>` is no bracket).
    let i = m.index + m[0].length;
    for (let depth = 1; depth > 0 && i < text.length; i += 1) {
      if (text[i] === '<') depth += 1;
      else if (text[i] === '>' && text[i - 1] !== '=') depth -= 1;
    }
    const line = text.slice(0, m.index).split('\n').length;
    const start = /^\(\s*(?=['`])/.exec(text.slice(i));
    if (!start) {
      other.push(`src/lib/api.ts:${line}: ${text.slice(m.index, i + 20).replace(/\s+/g, ' ')}`);
      continue;
    }
    const args = text.slice(i, closing(text, i));
    const end = stringEnd(args, start[0].length);
    const literal = args.slice(start[0].length + 1, end - 1);
    // The options after the path: { method: 'POST', ... }.
    const method = /\bmethod:\s*'([A-Z]+)'/.exec(args.slice(end))?.[1] ?? 'GET';
    // A template part (`${id}`) stands for a path segment or a query.
    calls.push({ method, path: literal.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '{param}'), line });
  }
  return { calls, other };
}

/** Every `Route::<method>('/path', ...)` of api/routes/api.php, as 'METHOD /path'. */
function laravelRoutes(text: string): Set<string> {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#).*$/gm, '');
  // Prefixed groups would change every path below them; this reader does not know them.
  assert.doesNotMatch(code, /->prefix\(|Route::prefix\(/, 'api/routes/api.php uses a route prefix: teach this test to apply it');
  const routes = new Set<string>();
  for (const m of code.matchAll(/Route::(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    routes.add(`${m[1].toUpperCase()} ${m[2].replace(/\{[^}]+\}/g, '{param}')}`);
  }
  return routes;
}

/** The calls only Laravel answers: two-factor sign-in and setup, the password and e-mail change. */
const laravelOnly = (c: Call) =>
  /^\/(login|user)\/two-factor(\/|$)/.test(c.path)
  || (c.method === 'PUT' && ['/user/password', '/user/email'].includes(c.path));

test('every Laravel-only call of the app is a route in api/routes/api.php', () => {
  const { calls, other } = clientCalls(read('src/lib/api.ts'));
  const routes = laravelRoutes(read('api/routes/api.php'));
  const selected = calls.filter(laravelOnly);
  console.log(`client calls: ${calls.length} read, ${selected.length} Laravel-only; Laravel routes: ${routes.size}`);
  // The only `request<` without a literal path is the function's own definition.
  assert.equal(other.length, 1, `request<...> without a literal path: ${other.join('; ')}`);
  assert.match(other[0], /request<T>\(path: string/, `request<...> without a literal path: ${other[0]}`);
  for (const c of selected) console.log(`  ${c.method} ${c.path} (src/lib/api.ts:${c.line})`);
  // The call map's ten two-factor and password calls and the e-mail change: a reader that finds
  // fewer has stopped seeing calls, and an empty list would pass.
  assert.ok(calls.length >= 50, `only ${calls.length} calls read from src/lib/api.ts`);
  assert.ok(selected.length >= 11, `only ${selected.length} Laravel-only calls found (expected at least 11)`);
  assert.ok(routes.size >= 11, `only ${routes.size} routes read from api/routes/api.php`);
  const missing = selected.filter((c) => !routes.has(`${c.method} ${c.path}`)).map((c) => `${c.method} ${c.path} (src/lib/api.ts:${c.line})`);
  assert.deepEqual(missing, [], 'calls Laravel does not answer: they would fall through to Node and get a 404');
});

test('every call of the app to a path Laravel owns uses a method Laravel serves there', () => {
  // Laravel answers a path it owns itself, with 405 for another method; Node never sees it.
  const { calls } = clientCalls(read('src/lib/api.ts'));
  const routes = laravelRoutes(read('api/routes/api.php'));
  const owned = new Set([...routes].map((r) => r.split(' ')[1]));
  const onLaravel = calls.filter((c) => owned.has(c.path));
  console.log(`client calls to the ${owned.size} paths Laravel owns: ${onLaravel.length}`);
  assert.ok(onLaravel.length >= 20, `only ${onLaravel.length} calls to Laravel's paths found`);
  const wrong = onLaravel.filter((c) => !routes.has(`${c.method} ${c.path}`)).map((c) => `${c.method} ${c.path} (src/lib/api.ts:${c.line})`);
  assert.deepEqual(wrong, [], 'calls with a method Laravel does not serve on its own path: they would get a 405');
});
