// Helpers for the deploy tests (deploy/test/*.test.mjs).
//
// Every `docker compose` here gets a minimal environment and an explicit env file, so neither
// the calling shell (which may export settings, such as ANTHROPIC_BASE_URL) nor a stray
// deploy/.env can supply a value. Nothing here starts the stack.
//
// DEPLOY_DIR (environment) points the tests at another deploy/ folder, for example an older
// version extracted with `git archive`; the env files and the repository's other files are
// always this checkout's.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEPLOY_DIR = path.resolve(process.env.DEPLOY_DIR || path.join(REPO_ROOT, 'deploy'));
export const COMPOSE_FILE = 'docker-compose.yml';
export const CI_OVERRIDE = 'docker-compose.ci.yml';
export const CI_ENV = path.join(REPO_ROOT, 'deploy', 'ci.env');

// A project name for `docker compose config`, which creates nothing.
const PROJECT = 'goenn-deploy-static';

// What docker needs to find its configuration, plugins and daemon, and nothing else.
const PASS_THROUGH = [
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'SYSTEMROOT',
  'TEMP', 'TMP', 'XDG_RUNTIME_DIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG',
  'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY',
];

export function minimalEnv() {
  const env = {};
  for (const name of PASS_THROUGH) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function composeArgs({ envFile = CI_ENV, files = [COMPOSE_FILE], profiles = [], deployDir = DEPLOY_DIR } = {}) {
  const args = ['compose', '-p', PROJECT, '--project-directory', deployDir, '--env-file', envFile];
  for (const f of files) args.push('-f', path.join(deployDir, f));
  for (const p of profiles) args.push('--profile', p);
  return args;
}

/** `docker compose <args>` with the minimal environment: { status, stdout, stderr }. */
export function compose(args, options = {}) {
  const r = spawnSync('docker', [...composeArgs(options), ...args], {
    env: minimalEnv(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const rendered = new Map();

/** The rendered configuration (`docker compose config --format json`), parsed and cached. */
export function renderConfig(options = {}) {
  const key = JSON.stringify(options);
  if (!rendered.has(key)) {
    const r = compose(['config', '--format', 'json'], options);
    if (r.status !== 0) throw new Error(`docker compose config failed (exit ${r.status}): ${r.stderr.trim()}`);
    rendered.set(key, JSON.parse(r.stdout));
  }
  return rendered.get(key);
}
