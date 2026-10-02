/**
 * A 401 during a session ends it on this device (F-20; the review's missed finding on in-session
 * 401 handling). The server answers 401 once a token has expired or was revoked - by a password
 * reset, a password or e-mail change or a two-factor change on another device. Without this the
 * app kept showing a signed-in state that the server no longer accepted.
 *
 * Every authenticated request reports its status and the token it was sent with
 * (src/lib/api.ts); the auth state subscribes and signs out locally (endLocalSession in
 * src/lib/auth-context.tsx, through signOutLocally below). Pure logic here, wiring there.
 */

/**
 * Whether an answer ends the current session: a 401 to a request that carried the current token.
 * A 401 to an older token (a request still in flight from before a new sign-in) changes nothing,
 * and requests without a token (sign-in, sign-up) never end a session.
 */
export function endsSession(status: number, requestToken: string | null | undefined, currentToken: string | null | undefined): boolean {
  return status === 401 && typeof requestToken === 'string' && requestToken !== '' && requestToken === currentToken;
}

/** What signing out on this device does, step by step (wired in src/lib/auth-context.tsx). */
export type LocalSignOutSteps = {
  /** Forgets the session in memory: the token the 401 listener compares with, token and user. */
  forget: () => void;
  /** Removes what the device stores for the session (the token). */
  clearStorage: () => Promise<void>;
  /** Tells the person why they were signed out (after a 401 only). */
  notice: () => Promise<void>;
};

/**
 * Signs out on this device in the one order that cannot leave the app half signed out: the
 * session is forgotten in memory first, so the screens switch to signed-out and later 401s find
 * nothing to end, whatever the storage does next. Earlier, a storage error before that step left
 * the screens signed in while the 401 listener had already stopped.
 *
 * A storage error is handled by cause:
 * - after a 401 (`rejected`) it is ignored and the person still gets the notice: the server
 *   already refuses that token, and the next app start removes the stored copy after its own 401;
 * - after a deliberate sign-out it is passed on, so the caller does not report success while a
 *   token that may still work is left on the device.
 */
export async function signOutLocally(steps: LocalSignOutSteps, rejected: boolean): Promise<void> {
  steps.forget();
  let failure: { error: unknown } | null = null;
  try {
    await steps.clearStorage();
  } catch (error) {
    failure = { error };
  }
  if (rejected) {
    await steps.notice();
    return;
  }
  if (failure) throw failure.error;
}

export type SessionListener = (rejectedToken: string) => void;

export type SessionWatch = {
  /** Called for every 401 to a request that carried a token. Returns the unsubscribe function. */
  subscribe(listener: SessionListener): () => void;
  /** Reports an answer; only 401s to requests with a token reach the listeners. */
  report(status: number, requestToken: string | null | undefined): void;
};

export function createSessionWatch(): SessionWatch {
  const listeners = new Set<SessionListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report(status, requestToken) {
      if (status !== 401 || typeof requestToken !== 'string' || requestToken === '') return;
      for (const listener of [...listeners]) listener(requestToken);
    },
  };
}
