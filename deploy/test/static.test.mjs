// Static checks of the production deploy (deploy/): the compose files as docker compose renders
// them, the Caddyfile as Caddy adapts it, the env files and the helper scripts. They need Docker
// (the CLI and the pinned caddy image) but no network and no running stack.
//
//   node --test deploy/test/static.test.mjs        (npm run test:deploy runs every deploy test)
//
// DEPLOY_DIR=<folder> runs the same checks against another deploy/ folder (lib.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  CI_ENV, CI_OVERRIDE, COMPOSE_FILE, DEPLOY_DIR, ENV_EXAMPLE, REPO_ROOT, RUNBOOK,
  caddyAdapt, caddyHandlers, composeAsync, dockerRun, envFileValues, inCidr, interpolations,
  ipToInt, mounts, parseEnvFile, readText, removeTemp, renderConfig, requiredSettings,
  serviceImage, variantEnvFile,
} from './lib.mjs';

const composeText = () => readText(path.join(DEPLOY_DIR, COMPOSE_FILE));
const base = () => renderConfig({ profiles: ['tools'] });
const ci = () => renderConfig({ files: [COMPOSE_FILE, CI_OVERRIDE], profiles: ['tools'] });
const ciValues = () => envFileValues(CI_ENV);
const posix = (p) => String(p).replaceAll('\\', '/');

/**
 * Every setting the production compose requires, and what kind of value it is. `decision`: a
 * business or retention decision nobody may guess (deploy/.env.example marks it DECISION and
 * names who decides). `secret`/`technical`: generated or chosen by whoever runs the server.
 */
const REQUIRED = {
  DOMAIN: 'decision',
  DB_PASSWORD: 'secret',
  DB_ROOT_PASSWORD: 'secret',
  APP_KEY: 'secret',
  NODE_INTERNAL_SECRET: 'secret',
  APP_NET_PREFIX: 'technical',
  ANTHROPIC_API_KEY: 'decision',
  EVIDENCE_RETENTION_DAYS: 'decision',
  MODERATION_REPORT_RETENTION_DAYS: 'decision',
  TOKEN_RETENTION_DAYS: 'decision',
  USAGE_RETENTION_DAYS: 'decision',
  MAIL_HOST: 'decision',
  MAIL_USERNAME: 'decision',
  MAIL_PASSWORD: 'decision',
  MAIL_FROM_ADDRESS: 'decision',
};
const REQUIRED_NAMES = Object.keys(REQUIRED).sort();
/** Required to be present, but empty is allowed (`${NAME?}`): a mail relay without a login. */
const MAY_BE_EMPTY = ['MAIL_PASSWORD', 'MAIL_USERNAME'];

const WRITE_CLASSES = ['MODERATED', 'COMMENT', 'CHAT', 'REACTION', 'RELATIONSHIP', 'BLOCK', 'REPORT', 'STATE', 'CONTENT', 'ACCOUNT', 'ADMIN', 'WEBHOOK'];
const AUTH_LIMITS = [
  'REGISTER_IP', 'REGISTER_ACCOUNT', 'LOGIN_ACCOUNT_IP', 'LOGIN_IP', 'LOGIN_ACCOUNT', 'FORGOT_IP',
  'FORGOT_ACCOUNT', 'RESET_IP', 'RESET_ACCOUNT', '2FA_CHALLENGE', '2FA_IP', '2FA_ACCOUNT',
  '2FA_RESEND_IP', '2FA_RESEND_ACCOUNT', '2FA_SETUP_USER', 'ACCOUNT_SENSITIVE_USER', 'PROFILE_USER',
  '2FA_FAILURES', 'LOCK_WAIT',
];

/**
 * The only settings with a default in the production compose, and why a default is right there.
 * `value`: the default it must have, when one is fixed.
 */
const ALLOWED_DEFAULTS = {
  MODERATION_FAIL_OPEN: { value: 'false', why: 'moderation fails closed; true is an explicit emergency switch' },
  MODERATION_ENABLED: { value: 'true', why: 'on is the safe value; production refuses false (server/src/config.js)' },
  MODERATION_MODEL: { why: "the maintainer's tuning, the same default as server/src/moderation.js; listed for confirmation" },
  MODERATION_BLOCK_SEVERITY: { why: "the maintainer's tuning, the same default as server/src/moderation.js; listed for confirmation" },
  MODERATION_TIMEOUT_SEVERITY: { why: "the maintainer's tuning, the same default as server/src/moderation.js; listed for confirmation" },
  MODERATION_TIMEOUT_DAYS: { why: "the maintainer's tuning, the same default as server/src/moderation.js; listed for confirmation" },
  SANCTUM_EXPIRATION: { value: '', why: 'empty = the security default in code (30 days), listed for confirmation' },
  FEATURE_IMPORTED_EVENTS: { value: '', why: 'empty = the hidden feature stays off' },
  FEATURE_ACCOUNT_TIERS: { value: '', why: 'empty = the hidden feature stays off' },
  LOG_LEVEL: { why: 'technical: how much Laravel logs' },
  MAIL_PORT: { why: 'technical: the mail submission port, overridden for providers that differ' },
  MAIL_SCHEME: { value: '', why: 'technical: empty = derived from the port' },
  ...Object.fromEntries(WRITE_CLASSES.map((c) => [`WRITE_LIMIT_${c}`, { value: '', why: 'empty = the engineering default in code (server/src/rate-limit.js)' }])),
  ...Object.fromEntries(AUTH_LIMITS.map((c) => [`AUTH_LIMIT_${c}`, { value: '', why: 'empty = the engineering default in code (api/config/ratelimits.php)' }])),
};

const servicesOf = (config) => Object.entries(config.services ?? {});
const healthTest = (s) => {
  const t = s.healthcheck?.test;
  return Array.isArray(t) ? t : t ? [t] : [];
};

// ------------------------------------------------------------------------------ settings

test('required settings: the production compose requires exactly the documented settings', () => {
  const found = requiredSettings(composeText());
  assert.ok(found.length > 0, 'no required setting found: refusing to report clean');
  console.log(`required settings: ${found.length} found, ${REQUIRED_NAMES.length} documented`);
  assert.deepEqual(found, REQUIRED_NAMES);
});

test('required settings: rendering without any env file value fails and names every required setting', async () => {
  const empty = variantEnvFile(CI_ENV, { drop: Object.keys(ciValues()) });
  try {
    assert.deepEqual(parseEnvFile(readText(empty)), [], 'the env file must be empty');
    const r = await composeAsync(['config', '--quiet'], { envFile: empty, profiles: ['tools'] });
    assert.notEqual(r.status, 0, 'docker compose config succeeded without any setting');
    const missing = REQUIRED_NAMES.filter((name) => !r.stderr.includes(`required variable ${name} is missing`));
    console.log(`empty env file: ${REQUIRED_NAMES.length - missing.length} of ${REQUIRED_NAMES.length} required settings named`);
    assert.deepEqual(missing, [], 'not named in the error');
  } finally {
    removeTemp(empty);
  }
});

test('required settings: the ci-only env file renders the compose, with and without the CI override', async () => {
  const variants = [
    { files: [COMPOSE_FILE] },
    { files: [COMPOSE_FILE], profiles: ['tools'] },
    { files: [COMPOSE_FILE, CI_OVERRIDE] },
    { files: [COMPOSE_FILE, CI_OVERRIDE], profiles: ['tools'] },
  ];
  for (const v of variants) {
    const r = await composeAsync(['config', '--quiet'], v);
    assert.equal(r.status, 0, `${JSON.stringify(v)}: ${r.stderr}`);
  }
});

test('required settings: dropping any single required setting blocks rendering', async () => {
  const cases = [];
  for (const name of REQUIRED_NAMES) {
    cases.push({ name, how: 'removed', change: { drop: [name] }, fails: true });
    cases.push({ name, how: 'empty', change: { set: { [name]: '' } }, fails: !MAY_BE_EMPTY.includes(name) });
  }
  console.log(`required settings: ${REQUIRED_NAMES.length} settings, ${cases.length} variants of deploy/ci.env`);
  const results = [];
  for (let i = 0; i < cases.length; i += 8) {
    results.push(...await Promise.all(cases.slice(i, i + 8).map(async (c) => {
      const file = variantEnvFile(CI_ENV, c.change);
      try {
        const r = await composeAsync(['config', '--quiet'], { envFile: file, profiles: ['tools'] });
        return { ...c, status: r.status, stderr: r.stderr };
      } finally {
        removeTemp(file);
      }
    })));
  }
  const wrong = results.filter((r) => (r.fails
    ? r.status === 0 || !r.stderr.includes(`required variable ${r.name} is missing`)
    : r.status !== 0)).map((r) => `${r.name} ${r.how}: exit ${r.status}`);
  assert.deepEqual(wrong, []);
});

test('required settings: only allow-listed settings have defaults, and fail-open defaults to false', () => {
  const text = composeText();
  const { defaulted, bare } = interpolations(text);
  assert.ok(defaulted.size > 0, 'no defaulted setting found: refusing to report clean');
  console.log(`defaults: ${defaulted.size} settings with a default, ${Object.keys(ALLOWED_DEFAULTS).length} allowed`);
  assert.deepEqual([...defaulted.keys()].filter((n) => !ALLOWED_DEFAULTS[n]), [], 'defaults that are not allow-listed');
  assert.deepEqual([...bare], [], 'interpolations without a default and without :? fill in an empty value silently');
  for (const [name, values] of defaulted) {
    assert.equal(values.size, 1, `${name} has different defaults: ${[...values].join(', ')}`);
    const expected = ALLOWED_DEFAULTS[name].value;
    if (expected !== undefined) assert.equal([...values][0], expected, `${name}'s default`);
  }
  assert.equal([...defaulted.get('MODERATION_FAIL_OPEN') ?? []][0], 'false');
  // The production compose never passes ANTHROPIC_BASE_URL: compose would prefer a value
  // exported in the operator's shell and send the moderation somewhere else.
  assert.equal(/ANTHROPIC_BASE_URL/.test(text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n')), false);
  assert.equal(base().services.node.environment.ANTHROPIC_BASE_URL, undefined);
  // The log mailer would write every code into the container log.
  assert.equal(base().services.api.environment.MAIL_MAILER, 'smtp');
});

test('required settings: the moderation defaults in the compose are the defaults in server/src/moderation.js', () => {
  const code = readText(path.join(REPO_ROOT, 'server', 'src', 'moderation.js'));
  const inCode = {
    MODERATION_MODEL: /env\.MODERATION_MODEL \|\| '([^']+)'/.exec(code)?.[1],
    ...Object.fromEntries([...code.matchAll(/intEnv\(env, '(MODERATION_[A-Z_]+)', (\d+)\)/g)].map((m) => [m[1], m[2]])),
  };
  const { defaulted } = interpolations(composeText());
  const names = ['MODERATION_MODEL', 'MODERATION_BLOCK_SEVERITY', 'MODERATION_TIMEOUT_SEVERITY', 'MODERATION_TIMEOUT_DAYS'];
  for (const name of names) {
    assert.ok(inCode[name] !== undefined, `cannot find ${name}'s default in server/src/moderation.js`);
    assert.equal([...(defaulted.get(name) ?? [])][0], inCode[name], name);
  }
});

test('settings are documented in .env.example (blank, with who decides), deploy/ci.env and the runbook', () => {
  const lines = readText(ENV_EXAMPLE).split(/\r?\n/);
  const example = parseEnvFile(readText(ENV_EXAMPLE));
  const ciNames = new Set(Object.keys(ciValues()));
  const runbook = readText(RUNBOOK);
  const problems = [];
  for (const name of REQUIRED_NAMES) {
    const entry = example.find((s) => s.name === name);
    if (!entry) { problems.push(`${name}: not in deploy/.env.example`); continue; }
    if (entry.value !== '') problems.push(`${name}: deploy/.env.example presets a value`);
    if (REQUIRED[name] === 'decision') {
      // The comment block the setting belongs to (contiguous non-blank lines) names the decision.
      let i = entry.line - 1;
      while (i > 0 && lines[i - 1].trim() !== '') i -= 1;
      const block = lines.slice(i, entry.line).join('\n');
      if (!/DECISION \([^)]+\)/.test(block)) problems.push(`${name}: no "DECISION (who)" in its comment block`);
    }
    if (!ciNames.has(name)) problems.push(`${name}: not in deploy/ci.env`);
    if (!new RegExp(`\`${name}(=[^\`]*)?\``).test(runbook)) problems.push(`${name}: not named in deploy/README.md`);
  }
  console.log(`documentation: ${REQUIRED_NAMES.length} required settings checked in 3 files`);
  assert.deepEqual(problems, []);
  assert.deepEqual(example.filter((s) => s.name.startsWith('ADMIN_')).map((s) => s.name), [], '.env.example assigns ADMIN_*');
});

test('ci-only env file is labelled and holds only fake values', () => {
  const text = readText(CI_ENV);
  const header = text.split(/\r?\n/).slice(0, 5).join('\n');
  assert.match(header, /CI-ONLY/);
  assert.match(header, /NOT for any real server/);
  const settings = parseEnvFile(text);
  assert.ok(settings.length > 0, 'no setting found: refusing to report clean');
  const services = new Set(Object.keys(ci().services));
  const secretName = /(password|passwd|[_-]pwd|secret|token|[_-]key)$/i;
  const fakeValue = [
    /^$/, /^\d+$/, /^(true|false)$/, /^localhost$/, /ci-only/, /not-a-secret/,
    /^[^@\s]+@example\.invalid$/, /^(\S+\.)?example\.invalid$/,
    /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?\/?$/,
    /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)(\.\d{1,3}){1,2}$/,
  ];
  const problems = [];
  for (const { name, value, line } of settings) {
    if (name.startsWith('ADMIN_')) problems.push(`${line}: ${name} (admin values never live in an env file)`);
    if (secretName.test(name) && value !== '' && !value.includes('not-a-secret')) problems.push(`${line}: ${name} has no not-a-secret marker`);
    if (!fakeValue.some((re) => re.test(value)) && !services.has(value)) problems.push(`${line}: ${name} does not look like a fake or ci-only value`);
  }
  console.log(`deploy/ci.env: ${settings.length} settings checked`);
  assert.deepEqual(problems, []);
});

// ------------------------------------------------------------------------------ F-10

test('F-10: deploy/ holds exactly one production compose wired caddy -> api -> node -> db', async (t) => {
  await t.test('the only compose files are docker-compose.yml and the labelled CI override', () => {
    const files = fs.readdirSync(DEPLOY_DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();
    console.log(`compose files in ${posix(DEPLOY_DIR)}: ${files.join(', ')}`);
    assert.ok(files.includes(COMPOSE_FILE), 'no docker-compose.yml');
    assert.deepEqual(files.filter((f) => f !== COMPOSE_FILE && f !== CI_OVERRIDE), [], 'a second compose file');
    for (const f of files.filter((name) => name === CI_OVERRIDE)) {
      const head = readText(path.join(DEPLOY_DIR, f)).split(/\r?\n/).slice(0, 2).join('\n');
      assert.match(head, /CI AND LOCAL TESTS ONLY - NOT FOR PRODUCTION/, `${f} must say it is not for production`);
    }
  });

  await t.test('the stack is caddy -> api (Laravel, api/) -> node (Node, server/) -> db', () => {
    const config = renderConfig();
    const services = config.services ?? {};
    for (const name of ['db', 'node', 'api', 'caddy']) assert.ok(services[name], `no service ${name}`);
    assert.match(posix(services.api.build?.context), /\/api$/, 'api is not built from api/ (Laravel)');
    assert.match(posix(services.node.build?.context), /\/server$/, 'node is not built from server/ (Node)');
    assert.match(services.db.image, /^mysql:/);
    assert.equal(services.api.environment.NODE_FALLBACK_URL, 'http://node:8000');
    assert.equal(services.api.environment.DB_HOST, 'db');
    assert.equal(services.node.environment.DB_HOST, 'db');
    const dials = caddyHandlers(caddyAdapt(path.join(DEPLOY_DIR, 'Caddyfile')))
      .filter((h) => h.handler === 'reverse_proxy')
      .flatMap((h) => (h.upstreams ?? []).map((u) => u.dial));
    console.log(`caddy upstreams: ${dials.join(', ')}`);
    assert.equal(dials.length, 1, 'caddy has exactly one upstream');
    assert.equal(dials[0].split(':')[0], 'api', "caddy's upstream is the Laravel service");
  });
});

// ------------------------------------------------------------------------------ F-05, F-18

test('F-05/F-18: ADMIN_EMAIL and ADMIN_PASSWORD reach only the one-off seed service', () => {
  const config = base();
  const withAdmin = servicesOf(config)
    .filter(([, s]) => Object.keys(s.environment ?? {}).some((k) => k.startsWith('ADMIN_')))
    .map(([name]) => name);
  console.log(`services: ${servicesOf(config).length}; with ADMIN_*: ${withAdmin.join(', ') || 'none'}`);
  assert.deepEqual(withAdmin, ['seed']);
  const seed = config.services.seed;
  assert.deepEqual(seed.profiles, ['tools'], 'seed must never start with `docker compose up`');
  assert.ok(!seed.restart || seed.restart === 'no', 'seed must not restart');
  // No value in the compose: they come from the operator's shell for one run.
  assert.equal(seed.environment.ADMIN_EMAIL, null);
  assert.equal(seed.environment.ADMIN_PASSWORD, null);
  assert.deepEqual(seed.command, ['npm', 'run', 'seed:admin']);
  // The seed runs the Node image: the same build as node.
  assert.deepEqual(seed.build, config.services.node.build);
});

test('F-05: caddy starts only after the admin gate found an admin account', () => {
  const config = base();
  assert.deepEqual(config.services.caddy.depends_on['admin-gate']?.condition, 'service_completed_successfully');
  const gate = config.services['admin-gate'];
  assert.ok(!gate.restart || gate.restart === 'no', 'the gate is a one-shot');
  assert.deepEqual(gate.entrypoint, ['bash', '/opt/deploy/admin-gate.sh']);
  assert.equal(gate.image, config.services.db.image, 'the gate uses the db image');
  const script = readText(path.join(DEPLOY_DIR, 'scripts', 'admin-gate.sh'));
  assert.match(script, /SELECT COUNT\(\*\) FROM users WHERE is_admin = 1/);
  assert.match(readText(path.join(REPO_ROOT, 'server', 'schema.sql')), /^\s+is_admin\s+TINYINT\(1\)/m, 'users.is_admin, which the gate counts');
});

test('F-18: no healthcheck carries a password', () => {
  const values = ciValues();
  const secrets = Object.entries(values).filter(([k, v]) => /PASSWORD|SECRET|_KEY$/.test(k) && v !== '').map(([, v]) => v);
  const checks = servicesOf(base()).filter(([, s]) => healthTest(s).length > 0);
  assert.ok(checks.length > 0, 'no healthcheck found: refusing to report clean');
  console.log(`healthchecks: ${checks.length} (${checks.map(([n]) => n).join(', ')})`);
  const problems = [];
  for (const [name, s] of checks) {
    const words = healthTest(s).join(' ');
    if (secrets.some((v) => words.includes(v))) problems.push(`${name}: contains a ci-only secret value`);
    if (/(^|\s)(-p\S|--password|-u\s*root)/.test(words) || /MYSQL_(ROOT_)?PASSWORD|MYSQL_PWD/.test(words)) problems.push(`${name}: names a password option`);
  }
  assert.deepEqual(problems, []);
});

// ------------------------------------------------------------------------------ F-29

test('F-29: uploads are mounted read-only into caddy, read-write only into node, never into api', () => {
  const config = base();
  const all = mounts(config);
  const of = (source) => all.filter((m) => m.type === 'volume' && m.source === source)
    .map((m) => `${m.service}:${m.read_only ? 'ro' : 'rw'}`).sort();
  assert.deepEqual(of('uploads'), ['caddy:ro', 'node:rw', 'storage-init:rw']);
  assert.deepEqual(of('private-media'), ['node:rw', 'storage-init:rw']);
  assert.deepEqual(all.filter((m) => m.service === 'api'), [], 'api mounts something');
  const binds = all.filter((m) => m.type === 'bind' && /storage/.test(posix(m.source)));
  assert.deepEqual(binds, [], 'an upload folder bound from the clone');
  console.log(`mounts: ${all.length} checked`);
});

test('F-29: caddy serves only stored public images from the volume and answers 404 for anything else under /storage', () => {
  const storage = readText(path.join(REPO_ROOT, 'server', 'src', 'storage.js'));
  const folders = /export const PUBLIC_FOLDERS = \[([^\]]+)\]/.exec(storage)?.[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  const privateFolders = /export const PRIVATE_FOLDERS = \[([^\]]+)\]/.exec(storage)?.[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  const name = /export const STORED_NAME = \/\^(.+)\$\/;/.exec(storage)?.[1];
  assert.ok(folders?.length && privateFolders?.length && name, 'cannot read PUBLIC_FOLDERS, PRIVATE_FOLDERS or STORED_NAME in server/src/storage.js');
  const expected = `^/storage/(${folders.join('|')})/${name}$`;

  const routes = caddyAdapt().apps.http.servers.srv0.routes[0].handle[0].routes;
  const uploadAt = routes.findIndex((r) => r.match?.[0]?.path_regexp);
  const storageAt = routes.findIndex((r) => r.match?.[0]?.path?.includes('/storage/*'));
  assert.ok(uploadAt >= 0 && storageAt > uploadAt, 'the upload route comes before the /storage 404');
  assert.equal(routes[uploadAt].match[0].path_regexp.pattern, expected, 'the allow-list mirrors server/src/storage.js');
  for (const folder of privateFolders) assert.ok(!expected.includes(folder), `private folder ${folder} is served`);
  const upload = caddyHandlers(routes[uploadAt]);
  assert.deepEqual(upload.map((h) => h.handler), ['subroute', 'vars', 'headers', 'file_server']);
  assert.equal(upload[1].root, '/srv');
  assert.match(upload[2].response.set['Content-Security-Policy'][0], /sandbox/);
  assert.deepEqual(caddyHandlers(routes[storageAt]).map((h) => [h.handler, h.status_code ?? null]), [['subroute', null], ['static_response', 404]]);
  assert.equal(routes[storageAt].match[0].path.includes('/storage'), true);
  assert.equal(caddyHandlers(caddyAdapt()).filter((h) => h.handler === 'file_server').length, 1, 'one file server only');
  console.log(`uploads: ${folders.length} public folders served, ${privateFolders.length} private folders not served`);
});

// ------------------------------------------------------------------------------ F-30

test('F-30: the Caddyfile validates and sets the security headers on normal and error routes', () => {
  const r = dockerRun(serviceImage('caddy'), {
    mounts: [{ src: path.join(DEPLOY_DIR, 'Caddyfile'), dst: '/etc/caddy/Caddyfile' }],
    env: { DOMAIN: 'localhost' },
    args: ['caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
  });
  assert.equal(r.status, 0, r.stderr);

  const server = caddyAdapt().apps.http.servers.srv0;
  const places = { routes: server.routes, 'error routes': server.errors?.routes };
  for (const [where, list] of Object.entries(places)) {
    assert.ok(list, `no ${where}`);
    const headers = caddyHandlers(list).filter((h) => h.handler === 'headers' && h.response);
    const deferred = headers.find((h) => h.response.deferred && h.response.set?.['Strict-Transport-Security']);
    assert.ok(deferred, `${where}: no deferred security header handler`);
    const set = deferred.response.set;
    assert.ok(Number(/max-age=(\d+)/.exec(set['Strict-Transport-Security'][0])?.[1]) >= 31536000, `${where}: HSTS max-age`);
    assert.deepEqual(set['X-Content-Type-Options'], ['nosniff'], where);
    assert.deepEqual(set['X-Frame-Options'], ['DENY'], where);
    assert.ok(set['Referrer-Policy']?.[0], `${where}: Referrer-Policy`);
    assert.match(set['Permissions-Policy']?.[0] ?? '', /camera=\(\).*geolocation=\(\).*microphone=\(\)/, `${where}: Permissions-Policy`);
    assert.deepEqual([...deferred.response.delete].sort(), ['Server', 'X-Powered-By'], where);
    const csp = headers.find((h) => h.response.require?.headers && 'Content-Security-Policy' in h.response.require.headers);
    assert.match(csp?.response.set['Content-Security-Policy'][0] ?? '', /frame-ancestors 'none'/, `${where}: default CSP`);
  }
});

test("F-31: caddy sends the client's TCP address to Laravel and overwrites a client-sent X-Forwarded-For", () => {
  const proxy = caddyHandlers(caddyAdapt()).filter((h) => h.handler === 'reverse_proxy');
  assert.equal(proxy.length, 1);
  assert.deepEqual(proxy[0].headers?.request?.set?.['X-Forwarded-For'], ['{http.request.remote.host}']);
  assert.deepEqual(proxy[0].headers?.request?.set?.['X-Forwarded-Proto'], ['{http.request.scheme}']);
});

test('request bodies: 9 MB only for multipart uploads, otherwise the largest body limit of the backends', () => {
  const php = readText(path.join(REPO_ROOT, 'api', 'app', 'Http', 'Middleware', 'LimitRequestBody.php'));
  const kb = ['JSON_LIMIT_KB', 'WEBHOOK_JSON_LIMIT_KB', 'URLENCODED_LIMIT_KB']
    .map((n) => Number(new RegExp(`const ${n} = (\\d+);`).exec(php)?.[1]));
  assert.ok(kb.every((n) => n > 0), 'cannot read the limits in LimitRequestBody.php');
  const upload = Number(/MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024/.exec(readText(path.join(REPO_ROOT, 'server', 'src', 'uploads.js')))?.[1]) * 1024 * 1024;
  const post = Number(/^post_max_size = (\d+)M/m.exec(readText(path.join(REPO_ROOT, 'api', 'docker', 'php.ini')))?.[1]) * 1024 * 1024;
  assert.ok(upload > 0 && post > 0, 'cannot read the upload limit or post_max_size');

  const routes = caddyAdapt().apps.http.servers.srv0.routes[0].handle[0].routes;
  const limits = routes.filter((r) => r.handle?.[0]?.handler === 'request_body');
  assert.equal(limits.length, 2, 'two request_body handlers');
  const multipart = limits.find((r) => r.match?.[0]?.header?.['Content-Type']?.[0] === 'multipart/form-data*');
  const other = limits.find((r) => r.match?.[0]?.not?.[0]?.header?.['Content-Type']?.[0] === 'multipart/form-data*');
  assert.ok(multipart && other, 'one limit for multipart, one for every other body, never both');
  assert.equal(multipart.handle[0].max_size, 9000000);
  assert.ok(multipart.handle[0].max_size > upload && multipart.handle[0].max_size < post, 'between the image limit and post_max_size');
  assert.equal(other.handle[0].max_size, Math.max(...kb) * 1024, 'the largest non-upload limit of Laravel and Node');
});

test('scripts the containers read from the working tree keep LF line ends', () => {
  const files = [
    ...fs.readdirSync(path.join(DEPLOY_DIR, 'scripts')).map((f) => path.join(DEPLOY_DIR, 'scripts', f)),
    path.join(DEPLOY_DIR, 'Caddyfile'),
  ];
  assert.ok(files.length > 1);
  assert.deepEqual(files.filter((f) => readText(f).includes('\r')).map(posix), []);
  const rel = files.map((f) => posix(path.relative(REPO_ROOT, f)));
  const r = spawnSync('git', ['-C', REPO_ROOT, 'check-attr', 'eol', '--', ...rel], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const notLf = r.stdout.trim().split('\n').filter((l) => !/: eol: lf$/.test(l));
  console.log(`line ends: ${files.length} files checked`);
  assert.deepEqual(notLf, [], '.gitattributes must pin eol=lf');
});

// ------------------------------------------------------------------------------ F-25

/** A reference is pinned when it ends in @sha256 and 64 hex digits. */
const PINNED = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

/** Image references of a Dockerfile: FROM images and COPY --from images (not stage names). */
function dockerfileImages(text, contexts = ['shared']) {
  const stages = new Set();
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const from = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      if (!stages.has(from[1].toLowerCase())) refs.push(from[1]);
      if (from[2]) stages.add(from[2].toLowerCase());
    }
    const copy = /^\s*COPY\s+.*--from=(\S+)/i.exec(line);
    if (copy && !stages.has(copy[1].toLowerCase()) && !contexts.includes(copy[1]) && !/^\d+$/.test(copy[1])) refs.push(copy[1]);
  }
  return refs;
}

/** `image:` values and the images of `docker run` lines in a workflow file. */
function workflowImages(text) {
  const refs = [...text.matchAll(/^\s*image:\s*['"]?([^\s'"#]+)/gm)].map((m) => m[1]);
  const built = new Set([...text.matchAll(/docker build\b[^\n]*--tag\s+(\S+)/g)].map((m) => m[1]));
  const withValue = new Set(['-v', '--volume', '-w', '--workdir', '-e', '--env', '--network', '--name', '--mount', '-p', '--publish', '--entrypoint', '-u', '--user', '--platform']);
  for (const m of text.matchAll(/docker run\b([^\n]*)/g)) {
    const words = m[1].trim().split(/\s+/);
    let i = 0;
    while (i < words.length && words[i].startsWith('-')) i += withValue.has(words[i]) ? 2 : 1;
    const image = words[i];
    if (image && !built.has(image)) refs.push(image);
  }
  return refs;
}

test('F-25: every image in the compose files, the workflows and the CI tool images is pinned by digest, and copies agree', () => {
  const refs = [];
  const add = (where, list) => list.forEach((ref) => refs.push({ where, ref }));
  for (const [label, config] of [['deploy compose', base()], ['deploy compose + CI override', ci()]]) {
    add(label, servicesOf(config).filter(([, s]) => s.image).map(([, s]) => s.image));
  }
  add('dev/docker-compose.yml', [...readText(path.join(REPO_ROOT, 'dev', 'docker-compose.yml')).matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]));
  const workflows = path.join(REPO_ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(workflows).filter((n) => /\.ya?ml$/.test(n))) add(`.github/workflows/${f}`, workflowImages(readText(path.join(workflows, f))));
  add('.github/actionlint/Dockerfile', dockerfileImages(readText(path.join(REPO_ROOT, '.github', 'actionlint', 'Dockerfile'))));
  assert.ok(refs.length > 0, 'no image reference found: refusing to report clean');
  console.log(`image references in scope: ${refs.length} (${new Set(refs.map((r) => r.ref)).size} distinct)`);
  assert.deepEqual(refs.filter((r) => !PINNED.test(r.ref)).map((r) => `${r.where}: ${r.ref}`), [], 'not pinned by digest');

  // Copies of one image tag carry one digest everywhere, the Dockerfiles included (their own pins
  // are checked by deploy/test/image.test.mjs).
  const dockerfiles = spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '*Dockerfile*'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
  for (const f of dockerfiles) add(f, dockerfileImages(readText(path.join(REPO_ROOT, f))));
  const byTag = new Map();
  for (const { where, ref } of refs) {
    const [tag, digest] = ref.split('@');
    if (!digest) continue;
    if (!byTag.has(tag)) byTag.set(tag, new Map());
    byTag.get(tag).set(digest, [...(byTag.get(tag).get(digest) ?? []), where]);
  }
  const differing = [...byTag].filter(([, digests]) => digests.size > 1).map(([tag, digests]) => `${tag}: ${[...digests].map(([d, w]) => `${d} (${[...new Set(w)].join(', ')})`).join(' / ')}`);
  console.log(`digest agreement: ${byTag.size} pinned tags across ${dockerfiles.length} Dockerfiles, the compose files and the workflows`);
  assert.deepEqual(differing, []);
});

test('F-25: Dependabot watches the Dockerfiles and the compose files of deploy/', () => {
  const text = readText(path.join(REPO_ROOT, '.github', 'dependabot.yml'));
  const entries = text.split(/^ {2}- package-ecosystem:/m).slice(1).map((chunk) => {
    const ecosystem = chunk.split('\n')[0].trim();
    const dirs = [...chunk.matchAll(/^\s+(?:directory:\s*|-\s+)(\/\S*)\s*$/gm)].map((m) => m[1]);
    return { ecosystem, dirs };
  });
  const dirsOf = (eco) => entries.filter((e) => e.ecosystem === eco).flatMap((e) => e.dirs);
  console.log(`dependabot: ${entries.length} update entries`);
  for (const dir of ['/api', '/server', '/.github/actionlint']) assert.ok(dirsOf('docker').includes(dir), `docker ${dir}`);
  for (const dir of ['/deploy', '/dev']) assert.ok(dirsOf('docker-compose').includes(dir), `docker-compose ${dir}`);
});

// ------------------------------------------------------------------------------ networks

test('networks: only caddy publishes ports (IPv4), db and the jobs sit on internal networks, caddy reaches neither node nor db', () => {
  const config = base();
  const services = servicesOf(config);
  const published = services.filter(([, s]) => (s.ports ?? []).length > 0).map(([n]) => n);
  assert.deepEqual(published, ['caddy']);
  for (const p of config.services.caddy.ports) assert.equal(p.host_ip, '0.0.0.0', `port ${p.target} is published for IPv4 only`);
  assert.deepEqual(config.services.caddy.ports.map((p) => `${p.published}:${p.target}`).sort(), ['443:443', '80:80']);

  const nets = config.networks;
  for (const [name, n] of Object.entries(nets)) assert.equal(n.enable_ipv6, false, `${name}: IPv6`);
  const internal = (name) => nets[name]?.internal === true;
  const on = (service) => Object.keys(config.services[service].networks ?? {});
  const shared = (a, b) => on(a).filter((n) => on(b).includes(n));
  assert.deepEqual(Object.keys(nets).filter((n) => !internal(n)).sort(), ['edge', 'outbound'], 'networks with a way out');
  assert.deepEqual(services.filter(([n]) => on(n).includes('edge')).map(([n]) => n).sort(), ['api', 'caddy']);
  assert.deepEqual(services.filter(([n]) => on(n).includes('outbound')).map(([n]) => n), ['node']);
  assert.ok(on('db').length > 0 && on('db').every(internal), 'db sits on internal networks only');
  for (const job of ['admin-gate', 'seed']) assert.deepEqual(on(job), ['data'], job);
  assert.equal(config.services['storage-init'].network_mode, 'none');
  assert.deepEqual(shared('caddy', 'node'), []);
  assert.deepEqual(shared('caddy', 'db'), []);
  // Exactly one shared network per hop: each backend sees the one before it at one address.
  assert.deepEqual(shared('caddy', 'api'), ['edge']);
  assert.deepEqual(shared('api', 'node'), ['app']);
  console.log(`networks: ${Object.keys(nets).length} networks, ${services.length} services checked`);
});

test('F-31: the trusted proxy addresses are the fixed addresses of caddy and api (mirror)', () => {
  const config = base();
  const { caddy, api, node } = config.services;
  const subnet = (name) => config.networks[name].ipam.config[0];
  const caddyIp = caddy.networks.edge.ipv4_address;
  const apiIp = api.networks.app.ipv4_address;
  assert.equal(api.environment.TRUSTED_PROXIES, caddyIp, 'Laravel trusts caddy');
  assert.equal(node.environment.NODE_TRUST_PROXY, apiIp, 'Node trusts api');
  for (const [ip, net] of [[caddyIp, 'edge'], [apiIp, 'app']]) {
    const { subnet: cidr, ip_range: range } = subnet(net);
    assert.ok(inCidr(ip, cidr), `${ip} lies in ${net} ${cidr}`);
    assert.ok(!inCidr(ip, range), `${ip} lies outside ${net}'s dynamic range ${range}: no other container can take it`);
    assert.notEqual(ipToInt(ip) % 2 ** (32 - Number(cidr.split('/')[1])), 1, `${ip} is not the gateway`);
  }
  const edge = subnet('edge').subnet;
  const app = subnet('app').subnet;
  assert.ok(!inCidr(app.split('/')[0], edge) && !inCidr(edge.split('/')[0], app), 'edge and app do not overlap');
  // The CI override keeps the same addresses: the stack test sees the production trust chain.
  const c = ci().services;
  assert.equal(c.api.environment.TRUSTED_PROXIES, c.caddy.networks.edge.ipv4_address);
  assert.equal(c.node.environment.NODE_TRUST_PROXY, c.api.networks.app.ipv4_address);
});

test('the CI override closes every network, publishes no port and keeps the moderation provider unreachable', () => {
  const config = ci();
  for (const [name, n] of Object.entries(config.networks)) assert.equal(n.internal, true, `${name} is internal in CI`);
  assert.deepEqual(servicesOf(config).filter(([, s]) => (s.ports ?? []).length > 0).map(([n]) => n), []);
  assert.equal(config.services.node.environment.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');
  assert.equal(config.services.api.environment.MAIL_HOST, 'mailpit');
  assert.deepEqual(Object.keys(config.services.mailpit.networks), ['app']);
});
