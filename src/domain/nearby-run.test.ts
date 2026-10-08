import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type RunKey,
  type RunState,
  completeRun,
  initialRunState,
  isResolving,
  startRun,
} from './nearby-run.ts';

type Coords = { lat: number; lng: number };

const here: Coords = { lat: 52.52, lng: 13.405 };
const there: Coords = { lat: 48.137, lng: 11.575 };

const key = (coords: Coords | null, signature: string): RunKey<Coords> => ({ coords, signature });

/** What the hook does on every render: adjust the run state, then derive `resolving`. */
function render(state: RunState<Coords>, current: RunKey<Coords>) {
  const next = startRun(state, current);
  return { state: next, resolving: isResolving(next, current) };
}

test('without a position nothing is resolving', () => {
  const first = render(initialRunState(key(null, 'A')), key(null, 'A'));
  assert.equal(first.resolving, false);
});

test('a run for a known position is resolving until it completes', () => {
  let step = render(initialRunState(key(null, 'A')), key(here, 'A'));
  assert.equal(step.resolving, true);

  step = render(completeRun(step.state, key(here, 'A')), key(here, 'A'));
  assert.equal(step.resolving, false);
});

test('a changed list starts a new run that is resolving', () => {
  const done = completeRun(initialRunState(key(here, 'A')), key(here, 'A'));
  assert.equal(render(done, key(here, 'B')).resolving, true);
});

test('a new position starts a new run that is resolving', () => {
  const done = completeRun(initialRunState(key(here, 'A')), key(here, 'A'));
  assert.equal(render(done, key(there, 'A')).resolving, true);
});

test('returning to an earlier list before the new run completes stays resolving (A, B, A)', () => {
  // The run for A completed.
  let step = render(completeRun(initialRunState(key(here, 'A')), key(here, 'A')), key(here, 'A'));
  assert.equal(step.resolving, false);

  // The list changes to B: the run for B starts.
  step = render(step.state, key(here, 'B'));
  assert.equal(step.resolving, true);

  // Back to A before B completes: B is cancelled and a new run for A starts.
  step = render(step.state, key(here, 'A'));
  assert.equal(step.resolving, true);

  // Only the completion of that new run ends it.
  step = render(completeRun(step.state, key(here, 'A')), key(here, 'A'));
  assert.equal(step.resolving, false);
});

test('a late completion for an earlier key does not end the current run', () => {
  let step = render(initialRunState(key(here, 'A')), key(here, 'A'));
  step = render(step.state, key(here, 'B'));

  step = render(completeRun(step.state, key(here, 'A')), key(here, 'B'));
  assert.equal(step.resolving, true);
});

test('an unchanged key keeps the same state object, so the hook sets no state', () => {
  const state = initialRunState(key(here, 'A'));
  assert.equal(startRun(state, key(here, 'A')), state);

  const done = completeRun(state, key(here, 'A'));
  assert.equal(startRun(done, key(here, 'A')), done);
});
