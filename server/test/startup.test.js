/**
 * The start order of the server process (F-33): the database step (src/index.js: ensureSchema and
 * the first clean-up) runs BEFORE the server listens, and a failed step ends the process with exit
 * code 1 instead of being logged and swallowed while the server keeps answering.
 *
 * Every case starts `node src/index.js` with the complete test environment
 * (test/support/startup-env.js). The one input that decides the outcome is the database address
 * (DB_HOST and DB_PORT): two stand-ins for the database run inside this test, one that accepts a
 * connection and never answers (the step hangs until the driver's connect timeout) and one that
 * hangs up at once (the step fails). PORT is set to a known free port only so the test can watch
 * it. The server connecting to a stand-in shows that the process has reached its database step,
 * so a slow module load can never pass for "not listening yet".
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { startupEnv } from './support/startup-env.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START_LINE = /Goenntertainment-Backend laeuft/;
/**
 * Generous on purpose (as in startup-settings.test.js): loading the server's modules takes well
 * under a second on CI, but many seconds from a slow mounted folder.
 */
const STARTUP_TIMEOUT_MS = 90_000;
/**
 * How long the process may take to end once its database step can no longer succeed: the driver
 * gives up on a silent database after its connect timeout (mysql2's default, 10 s), then the
 * process closes its pool and ends. Generous for slow machines.
 */
const EXIT_AFTER_FAILURE_MS = 30_000;
/** Pause between two attempts to connect to the server's port. */
const PROBE_INTERVAL_MS = 100;

/** Children and stand-ins still open when a test ends early (stopped in after()). */
const children = new Set();
const standIns = new Set();

after(async () => {
  for (const child of children) child.kill();
  for (const standIn of standIns) await standIn.close();
});

/** A local TCP port that is free right now (the system picks it). */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * A stand-in for the database on 127.0.0.1. 'silent' accepts every connection and never sends a
 * byte (the MySQL greeting never comes); 'hang-up' closes every connection at once. `connected`
 * resolves on the first connection, `connections` counts them.
 */
async function standInDatabase(mode) {
  const sockets = new Set();
  let connections = 0;
  let firstConnection;
  const connected = new Promise((resolve) => {
    firstConnection = resolve;
  });
  const server = net.createServer((socket) => {
    connections += 1;
    firstConnection();
    socket.on('error', () => {});
    if (mode === 'hang-up') {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const standIn = {
    port: server.address().port,
    connected,
    get connections() {
      return connections;
    },
    close() {
      standIns.delete(standIn);
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
  standIns.add(standIn);
  return standIn;
}

/** Starts the server; `exited` resolves with { code, signal } when the process ends. */
function startServer(env) {
  const child = spawn(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      children.delete(child);
      resolve({ code, signal });
    });
  });
  return {
    exited,
    stdout: () => stdout,
    stderr: () => stderr,
    running: () => child.exitCode === null && child.signalCode === null,
    stop: () => child.kill(),
  };
}

/**
 * The result of `promise`, or `fallback` once `ms` have passed. The timer does not keep the test
 * process alive after the promise has settled.
 */
const within = (promise, ms, fallback) => Promise.race([promise, delay(ms, fallback, { ref: false })]);

/** True if a TCP connection to the local port is accepted, false if it is refused. */
function accepts(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Process output for an assertion message (test values only: the stand-ins and startup-env.js). */
const outputOf = (server) => `\n--- stdout\n${server.stdout()}\n--- stderr\n${server.stderr()}`;

test('startup: does not accept connections before the schema step has finished', async (t) => {
  const database = await standInDatabase('silent');
  const port = await freePort();
  const server = startServer(startupEnv({ DB_HOST: '127.0.0.1', DB_PORT: String(database.port), PORT: String(port) }));
  try {
    const reached = await within(
      Promise.race([database.connected.then(() => true), server.exited.then(() => false)]),
      STARTUP_TIMEOUT_MS,
      false,
    );
    assert.ok(reached, `the server never connected to the database${outputOf(server)}`);

    // The stand-in never answers, so the schema step cannot finish: until the process ends,
    // every attempt to connect to its port must be refused.
    let attempts = 0;
    let acceptedAt = 0;
    const deadline = Date.now() + EXIT_AFTER_FAILURE_MS;
    while (server.running() && Date.now() < deadline) {
      attempts += 1;
      if (await accepts(port)) {
        acceptedAt = attempts;
        break;
      }
      await delay(PROBE_INTERVAL_MS);
    }
    t.diagnostic(`${attempts} connection attempt(s) while the schema step was running`);
    assert.equal(acceptedAt, 0, `the server accepted connection attempt ${acceptedAt} before the schema step finished`);
    assert.ok(attempts > 0, 'no connection attempt was made: the check saw nothing');

    const exit = await within(server.exited, EXIT_AFTER_FAILURE_MS, null);
    assert.ok(exit !== null, `still running after the schema step could not finish${outputOf(server)}`);
    assert.equal(exit.code, 1, `expected exit code 1, got ${exit.code} (signal ${exit.signal})${outputOf(server)}`);
    assert.doesNotMatch(server.stdout(), START_LINE, 'the server reported that it listens');
  } finally {
    server.stop();
    await database.close();
  }
});

test('startup: exits with code 1 when the schema step fails', async (t) => {
  const database = await standInDatabase('hang-up');
  const port = await freePort();
  const server = startServer(startupEnv({ DB_HOST: '127.0.0.1', DB_PORT: String(database.port), PORT: String(port) }));
  try {
    const reached = await within(
      Promise.race([database.connected.then(() => true), server.exited.then(() => false)]),
      STARTUP_TIMEOUT_MS,
      false,
    );
    assert.ok(reached, `the server never connected to the database${outputOf(server)}`);

    const exit = await within(server.exited, EXIT_AFTER_FAILURE_MS, null);
    t.diagnostic(`${database.connections} connection(s) to the database stand-in, each closed at once`);
    assert.ok(
      exit !== null,
      `still running ${EXIT_AFTER_FAILURE_MS / 1000} s after the database closed the connection of the schema step${outputOf(server)}`,
    );
    assert.equal(exit.code, 1, `expected exit code 1, got ${exit.code} (signal ${exit.signal})${outputOf(server)}`);
    assert.match(server.stderr(), /Database setup failed/, 'the log does not say why the server stopped');
    assert.doesNotMatch(server.stdout(), START_LINE, 'the server reported that it listens');
  } finally {
    server.stop();
    await database.close();
  }
});

test('startup: listens once the schema step has succeeded', async (t) => {
  // The test database (the harness or CI provide DB_*): the schema step succeeds and the
  // container health check route answers.
  const port = await freePort();
  const server = startServer(startupEnv({ PORT: String(port) }));
  try {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let attempts = 0;
    let health = null;
    while (health === null && server.running() && Date.now() < deadline) {
      attempts += 1;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/internal/health`, { signal: AbortSignal.timeout(5000) });
        health = { status: res.status, body: await res.json() };
      } catch {
        await delay(250);
      }
    }
    t.diagnostic(`${attempts} request(s) to /internal/health`);
    assert.ok(health !== null, `the server never answered on its port${outputOf(server)}`);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true });
  } finally {
    server.stop();
  }
});
