// Static checks of the container images built from this repository (api/Dockerfile,
// server/Dockerfile) and of what they ship. They read files only and need neither Docker nor a
// network.
//
//   node --test deploy/test/image.test.mjs
//
// A Dockerfile is read as stages. "The final stage" is the last FROM, the image that runs;
// "its chain" is that stage plus every stage it is built FROM (for example runtime <- base).
// Instructions of other stages (the build stage) never reach the running image, so only the
// chain counts for what the image ships. Every check prints how many things it examined and
// refuses to pass on zero.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(file) {
  return readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * The instructions of a Dockerfile: comment lines dropped (also inside a continued
 * instruction, as Docker does), continuation lines joined. Each is { keyword, args, line }.
 */
function instructionsOf(text) {
  const joined = [];
  let current = null;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const continued = line.endsWith('\\');
    const part = continued ? line.slice(0, -1).trim() : line;
    if (current) current.text += ` ${part}`;
    else current = { text: part, line: index + 1 };
    if (!continued) {
      joined.push(current);
      current = null;
    }
  });
  if (current) joined.push(current);
  return joined.map(({ text: instruction, line }) => {
    const m = /^(\S+)\s*([\s\S]*)$/.exec(instruction);
    return { keyword: m[1].toUpperCase(), args: m[2].trim(), line };
  });
}

/** The stages of a Dockerfile: { image, name, line, instructions } in file order. */
function stagesOf(text) {
  const stages = [];
  for (const instruction of instructionsOf(text)) {
    if (instruction.keyword === 'FROM') {
      const tokens = instruction.args.split(/\s+/).filter((t) => !t.startsWith('--'));
      const as = tokens.findIndex((t) => t.toUpperCase() === 'AS');
      stages.push({
        image: tokens[0],
        name: as > 0 && tokens[as + 1] ? tokens[as + 1].toLowerCase() : null,
        line: instruction.line,
        instructions: [],
      });
    } else if (stages.length > 0) {
      stages.at(-1).instructions.push(instruction);
    }
    // Instructions before the first FROM can only be global ARGs: they belong to no image.
  }
  return stages;
}

/** The final stage and the stages it is built FROM, oldest first. */
function finalChain(stages) {
  const chain = [];
  let index = stages.length - 1;
  while (index >= 0) {
    const current = index;
    const parent = stages[current].image.toLowerCase();
    chain.unshift(stages[current]);
    index = stages.findLastIndex((s, i) => i < current && s.name === parent);
  }
  return chain;
}

/** A Dockerfile's stages, its final chain and all instructions of that chain in build order. */
function finalInstructions(file) {
  const stages = stagesOf(read(file));
  assert.ok(stages.length > 0, `${file}: no FROM found`);
  const chain = finalChain(stages);
  return { stages, chain, instructions: chain.flatMap((s) => s.instructions) };
}

/** The user part of a USER value ("www-data:www-data" -> "www-data"). */
function userOf(value) {
  return value.trim().split(/\s+/)[0].split(':')[0];
}

/** The user the final chain ends with, or null when it sets none (then the image runs as root). */
function lastUser(instructions) {
  const users = instructions.filter((i) => i.keyword === 'USER');
  return users.length > 0 ? userOf(users.at(-1).args) : null;
}

// ------------------------------------------------------------------ F-28: the api image

test('F-28: the api image runs as a non-root user in its final stage', (t) => {
  const { stages, chain, instructions } = finalInstructions('api/Dockerfile');
  t.diagnostic(`api/Dockerfile: ${stages.length} stage(s), final chain ${chain.length}, ${instructions.length} instruction(s)`);
  const user = lastUser(instructions);
  assert.ok(user !== null, 'the final stage of api/Dockerfile sets no USER: Apache and PHP would run as root');
  assert.ok(!['root', '0'].includes(user), `the final stage of api/Dockerfile runs as ${user}`);
});

test('F-28: the api image ships no Composer in its final stage', (t) => {
  const { chain, instructions } = finalInstructions('api/Dockerfile');
  t.diagnostic(`checked ${instructions.length} instruction(s) of the final chain (${chain.length} stage(s))`);
  assert.ok(instructions.length > 0, 'the final chain of api/Dockerfile has no instructions');
  const found = instructions.filter((i) => /composer/i.test(i.args));
  assert.deepEqual(
    found.map((i) => `line ${i.line}: ${i.keyword} ${i.args}`),
    [],
    'Composer (or a package step that needs it) reaches the running api image',
  );
});

test('F-28: the api image listens on port 8080, which needs no root', (t) => {
  const { instructions } = finalInstructions('api/Dockerfile');
  const exposed = instructions.filter((i) => i.keyword === 'EXPOSE').flatMap((i) => i.args.split(/\s+/));
  t.diagnostic(`EXPOSE in the final chain: ${exposed.join(', ') || 'none'}`);
  assert.deepEqual(exposed, ['8080'], 'the api image must expose exactly port 8080');
  const run = instructions.filter((i) => i.keyword === 'RUN').map((i) => i.args).join('\n');
  assert.match(run, /Listen 8080/, "Apache's ports.conf is not switched to Listen 8080 in the final chain");
  assert.match(run, /<VirtualHost \\?\*:8080>/, 'the default site is not switched to port 8080 in the final chain');
  const health = instructions.filter((i) => i.keyword === 'HEALTHCHECK');
  assert.equal(health.length, 1, 'the api image needs exactly one HEALTHCHECK');
  assert.match(health[0].args, /127\.0\.0\.1:8080\//, 'the healthcheck does not ask port 8080');
});

// ------------------------------------------------------------------ F-29: no uploads under the api docroot

/** <Directory> blocks of an Apache file: { path, directives } with comments dropped, lower case. */
function directoryBlocks(conf) {
  const text = conf
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  return [...text.matchAll(/<Directory\s+"?([^">\s]+)"?\s*>([\s\S]*?)<\/Directory\s*>/gi)].map((m) => ({
    path: m[1].replace(/\/+$/, ''),
    directives: m[2]
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' ').toLowerCase())
      .filter(Boolean),
  }));
}

/** Where the api image installs api/docker/apache.conf: { name } of conf-available/<name>.conf. */
function installedApacheConf(instructions) {
  const copies = instructions
    .filter((i) => i.keyword === 'COPY')
    .map((i) => /docker\/apache\.conf\s+\S*\/conf-available\/([\w.-]+)\.conf$/.exec(i.args)?.[1])
    .filter(Boolean);
  assert.equal(copies.length, 1, `api/docker/apache.conf is installed ${copies.length} times into conf-available/`);
  return { name: copies[0] };
}

/** The Apache docroot the api image sets (APACHE_DOCUMENT_ROOT) and its uploads path below it. */
function apiDocroot(instructions) {
  const docroot = instructions
    .filter((i) => i.keyword === 'ENV')
    .map((i) => /APACHE_DOCUMENT_ROOT[=\s]+(\S+)/.exec(i.args)?.[1])
    .find(Boolean);
  assert.ok(docroot, 'APACHE_DOCUMENT_ROOT is not set in the final chain of api/Dockerfile');
  return { docroot, uploads: `${docroot.replace(/\/+$/, '')}/storage` };
}

test('F-29: the api image has no upload folder under its docroot and its build refuses one', (t) => {
  const { instructions } = finalInstructions('api/Dockerfile');
  const { uploads } = apiDocroot(instructions);
  const run = instructions.filter((i) => i.keyword === 'RUN');
  t.diagnostic(`uploads path under the docroot: ${uploads}; RUN instructions in the final chain: ${run.length}`);
  assert.ok(run.length > 0, 'the final chain of api/Dockerfile has no RUN instruction');
  const creates = run.filter((i) => /\bmkdir\b[^;&|]*\bpublic\/storage\b/.test(i.args));
  assert.deepEqual(creates.map((i) => `line ${i.line}`), [], 'the final chain creates public/storage');
  // -e follows a symbolic link (a dangling one passes it), so -L must be there too.
  for (const flag of ['-e', '-L']) {
    assert.ok(
      run.some((i) => new RegExp(`\\btest ! ${flag} \\S*public/storage\\b`).test(i.args)),
      `the build does not refuse a public/storage that came in with the code (test ! ${flag})`,
    );
  }
});

test('F-29: Apache in the api image refuses an upload folder mounted under its docroot', (t) => {
  const { instructions } = finalInstructions('api/Dockerfile');
  const { docroot, uploads } = apiDocroot(instructions);

  // The image installs and enables the file that holds the rule.
  const { name } = installedApacheConf(instructions);
  assert.ok(
    instructions.some((i) => i.keyword === 'RUN' && new RegExp(`\\ba2enconf ${name}(\\s|$)`).test(i.args)),
    `the ${name} Apache configuration is not enabled`,
  );

  // Should a folder be mounted or linked there later: no access, no PHP, no .htaccess.
  const blocks = directoryBlocks(read('api/docker/apache.conf')).filter((b) => b.path === uploads);
  t.diagnostic(`docroot ${docroot}; <Directory ${uploads}> blocks: ${blocks.length}`);
  assert.ok(blocks.length > 0, `api/docker/apache.conf has no <Directory ${uploads}> block`);
  const directives = blocks.flatMap((b) => b.directives);
  for (const required of ['require all denied', 'allowoverride none', 'php_admin_flag engine off']) {
    assert.ok(directives.includes(required), `<Directory ${uploads}> lacks "${required}"`);
  }
  const grants = directives.filter((d) => d.startsWith('require') && d !== 'require all denied');
  assert.deepEqual(grants, [], `<Directory ${uploads}> grants access`);
});

// ------------------------------------------------------------------ Apache's own answers

/**
 * The files the pinned base image (php:8.4-apache) enables in /etc/apache2/conf-enabled. Apache
 * reads them in name order, and a later file wins: security.conf sets ServerTokens OS and
 * ServerSignature On. The build's own check (a RUN in api/Dockerfile) compares with the real
 * folder; this list only lets the test fail early.
 */
const BASE_CONF_ENABLED = ['charset.conf', 'docker-php.conf', 'localized-error-pages.conf', 'other-vhosts-access-log.conf', 'security.conf', 'serve-cgi-bin.conf'];

test("F-30: the project's Apache settings load after Debian's security.conf, so Apache's own pages name no version", (t) => {
  const { instructions } = finalInstructions('api/Dockerfile');
  const { name } = installedApacheConf(instructions);
  const file = `${name}.conf`;
  t.diagnostic(`installed as conf-available/${file}; base image files it must sort after: ${BASE_CONF_ENABLED.length}`);
  // Apache sorts the names byte by byte, as JavaScript compares strings of ASCII letters.
  assert.deepEqual(BASE_CONF_ENABLED.filter((f) => !(f < file)), [], `conf-enabled/${file} loads before these, which then win`);
  assert.ok(
    instructions.some((i) => i.keyword === 'RUN' && i.args.includes(`test "$(ls /etc/apache2/conf-enabled | tail -n 1)" = ${file}`)),
    `the build does not check that ${file} is the last file in conf-enabled/`,
  );
  const conf = read('api/docker/apache.conf').split('\n').filter((line) => !/^\s*#/.test(line)).map((line) => line.trim());
  assert.ok(conf.includes('ServerTokens Prod'), 'api/docker/apache.conf does not set ServerTokens Prod');
  assert.ok(conf.includes('ServerSignature Off'), 'api/docker/apache.conf does not set ServerSignature Off');
});

test("F-28: the api site names the public https origin, so Apache's own redirects never point at port 8080", (t) => {
  const { instructions } = finalInstructions('api/Dockerfile');
  const run = instructions.filter((i) => i.keyword === 'RUN').map((i) => i.args);
  // ServerName inside the site that serves port 8080: a global one would lose to the site's port.
  const insert = run.find((args) => /<VirtualHost \*:8080>\\n\\tServerName \$\{APP_URL\}\//.test(args));
  t.diagnostic(`RUN instructions in the final chain: ${run.length}`);
  assert.ok(insert, 'no RUN puts ServerName ${APP_URL} as the first line of <VirtualHost *:8080>');
  assert.match(insert, /grep -A1 -x '<VirtualHost \\\*:8080>' \S+000-default\.conf \| grep -qx '\[\[:space:\]\]\*ServerName \$\{APP_URL\}'/, 'the build does not check the inserted line');
  // APP_URL is the public origin, https and without a port.
  const compose = read('deploy/docker-compose.yml');
  const appUrl = [...compose.matchAll(/^\s+APP_URL:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(appUrl, ['https://${DOMAIN:?DOMAIN'], 'the compose does not set APP_URL to https://<DOMAIN> for api');
});

// ------------------------------------------------------------------ F-25 and the server image

const DOCKERFILES = ['api/Dockerfile', 'server/Dockerfile'];

/**
 * The named build contexts the compose hands to the image builds (`additional_contexts`, map or
 * list form): `COPY --from=<context>` reads a folder, not an image.
 */
function namedBuildContexts() {
  const lines = read('deploy/docker-compose.yml').split('\n');
  const names = new Set();
  lines.forEach((line, index) => {
    const head = /^(\s*)additional_contexts:\s*$/.exec(line);
    if (!head) return;
    const indent = head[1].length;
    for (const next of lines.slice(index + 1)) {
      const own = /^(\s*)/.exec(next)[1].length;
      if (next.trim() === '' || next.trim().startsWith('#')) continue;
      if (own <= indent) break;
      const entry = /^\s*(?:-\s*)?([\w.-]+)\s*[:=]/.exec(next);
      if (entry) names.add(entry[1]);
    }
  });
  return names;
}

/** Every image a Dockerfile pulls: FROM lines that name no earlier stage, and --from= images. */
function imageReferences(file, contexts) {
  const stages = stagesOf(read(file));
  const references = [];
  stages.forEach((stage, index) => {
    const earlier = new Set(stages.slice(0, index).map((s) => s.name).filter(Boolean));
    if (!earlier.has(stage.image.toLowerCase())) {
      references.push({ image: stage.image, where: `${file}:${stage.line} FROM` });
    }
    for (const instruction of stage.instructions) {
      const froms = [
        ...instruction.args.matchAll(/(?:^|\s)--from=(\S+)/g),
        ...instruction.args.matchAll(/--mount=\S*?\bfrom=([^,\s]+)/g),
      ].map((m) => m[1]);
      for (const from of froms) {
        if (earlier.has(from.toLowerCase()) || /^\d+$/.test(from) || contexts.has(from)) continue;
        references.push({ image: from, where: `${file}:${instruction.line} ${instruction.keyword} --from` });
      }
    }
  });
  return references;
}

test('F-25: every image the Dockerfiles build from is pinned by digest, and copies agree', (t) => {
  const contexts = namedBuildContexts();
  assert.ok(contexts.size > 0, 'no additional_contexts found in deploy/docker-compose.yml');
  const references = DOCKERFILES.flatMap((file) => imageReferences(file, contexts));
  t.diagnostic(`named build contexts (not images): ${[...contexts].join(', ')}`);
  t.diagnostic(`image references: ${references.length}`);
  for (const r of references) t.diagnostic(`  ${r.where}: ${r.image}`);
  assert.ok(references.length > 0, 'no image reference found in the Dockerfiles');

  const pinned = /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[0-9a-f]{64}$/;
  const unpinned = references.filter((r) => !pinned.test(r.image));
  assert.deepEqual(
    unpinned.map((r) => `${r.where}: ${r.image}`),
    [],
    'every image must be written as <name>:<tag>@sha256:<index digest>',
  );

  const digests = new Map();
  for (const r of references) {
    const [name, digest] = r.image.split('@');
    digests.set(name, (digests.get(name) ?? new Set()).add(digest));
  }
  const disagree = [...digests].filter(([, set]) => set.size > 1).map(([name, set]) => `${name}: ${[...set].join(' vs ')}`);
  assert.deepEqual(disagree, [], 'two copies of one image name different digests');
});

test('F-28: the server image runs as a non-root user in its final stage', (t) => {
  const { stages, instructions } = finalInstructions('server/Dockerfile');
  t.diagnostic(`server/Dockerfile: ${stages.length} stage(s), ${instructions.length} instruction(s) in the final chain`);
  const user = lastUser(instructions);
  assert.ok(user !== null, 'the final stage of server/Dockerfile sets no USER');
  assert.ok(!['root', '0'].includes(user), `the final stage of server/Dockerfile runs as ${user}`);
});
