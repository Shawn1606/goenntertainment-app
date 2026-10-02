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
  assert.ok(
    run.some((i) => /\btest ! -e \S*public\/storage\b/.test(i.args)),
    'the build does not refuse a public/storage that came in with the code',
  );
});

test('F-29: Apache in the api image refuses an upload folder mounted under its docroot', (t) => {
  const { instructions } = finalInstructions('api/Dockerfile');
  const { docroot, uploads } = apiDocroot(instructions);

  // The image installs and enables the file that holds the rule.
  assert.ok(
    instructions.some((i) => i.keyword === 'COPY' && /docker\/apache\.conf\s+\S*conf-available\/goenn\.conf$/.test(i.args)),
    'api/docker/apache.conf is not installed as conf-available/goenn.conf',
  );
  assert.ok(
    instructions.some((i) => i.keyword === 'RUN' && /\ba2enconf goenn\b/.test(i.args)),
    'the goenn Apache configuration is not enabled',
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
