/**
 * Bookkeeping for the geocoding run of `useNearbyActivities`: which position and
 * list the current run is for, and for which one a run last completed. Pure logic
 * without React or expo-location, so the sequences that decide `resolving` are
 * testable in Node (`npm test`).
 */

/**
 * The position and list signature a geocoding run is for. `coords` is null while no
 * position is known; it is compared by identity, the same way the hook's effect
 * compares its dependencies, so a new position object means a new run.
 */
export type RunKey<C> = { coords: C | null; signature: string };

export type RunState<C> = {
  /** The key the current run is for. */
  runFor: RunKey<C>;
  /** The key a run last completed for since `runFor` was set; null until then. */
  resolvedFor: RunKey<C> | null;
};

function sameKey<C>(a: RunKey<C> | null, b: RunKey<C>): boolean {
  return a !== null && a.coords === b.coords && a.signature === b.signature;
}

/** State for the first render: the run for `key` has not completed yet. */
export function initialRunState<C>(key: RunKey<C>): RunState<C> {
  return { runFor: key, resolvedFor: null };
}

/**
 * Called while rendering, before the effect starts the run for `key`. A new key
 * means a new run, so an earlier completion no longer counts, even one for the same
 * key: after A, B and back to A, the new run for A is still in flight. Returns the
 * same object when the key is unchanged, so the caller sets state only on a change.
 */
export function startRun<C>(state: RunState<C>, key: RunKey<C>): RunState<C> {
  if (sameKey(state.runFor, key)) return state;
  return { runFor: key, resolvedFor: null };
}

/** Called when the run for `key` completed without being cancelled. */
export function completeRun<C>(state: RunState<C>, key: RunKey<C>): RunState<C> {
  return { ...state, resolvedFor: key };
}

/** true while a position is known and no run has completed for `key` yet. */
export function isResolving<C>(state: RunState<C>, key: RunKey<C>): boolean {
  return key.coords !== null && !sameKey(state.resolvedFor, key);
}
