// Tests that the registered Node schema copies can be run in isolation, the contract
// the drift check relies on (README.md "Contract for a Node copy"). No MySQL: the
// copies run against the recording pool only. Needs the server's dependencies
// (npm ci --prefix server), like the check itself.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { addColumnOrderProblems, summarizeDiscovery } from './compare.mjs';
import { NODE_COPIES } from './copies.mjs';
import { discover, loadNodeCopies } from './node-copies.mjs';

let env;

before(async () => {
  env = await loadNodeCopies();
});

test('every registered Node copy imports without running a query and exports its schema function', () => {
  assert.deepEqual(env.problems, []);
  assert.deepEqual(
    env.loaded.map((c) => c.id),
    NODE_COPIES.map((c) => c.id),
  );
  assert.equal(env.guard.hits, 0, 'a query reached the guarded pool outside a pass');
});

for (const copy of NODE_COPIES) {
  test(`discovery runs ${copy.id} and records only statements the check models, in an order MySQL accepts`, async () => {
    const loaded = env.loaded.find((c) => c.id === copy.id);
    assert.ok(loaded, `${copy.id} did not load`);
    const { statements, error } = await discover(env, loaded);
    assert.equal(error, null, `discovery of ${copy.id} threw: ${error?.message}`);
    const summary = summarizeDiscovery(statements);
    assert.ok(summary.createSet.length + summary.addColumns.length > 0, `${copy.id} defines nothing`);
    assert.deepEqual(
      statements.filter((s) => s.type === 'unsupported').map((s) => `${s.reason}: ${s.head}`),
      [],
    );
    assert.deepEqual(addColumnOrderProblems(statements), []);
  });
}
