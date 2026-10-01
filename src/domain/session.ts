/**
 * A 401 during a session ends it on this device (F-20; the review's missed finding on in-session
 * 401 handling). The server answers 401 once a token has expired or was revoked - by a password
 * reset, a password or e-mail change or a two-factor change on another device. Without this the
 * app kept showing a signed-in state that the server no longer accepted.
 *
 * Every authenticated request reports its status and the token it was sent with
 * (src/lib/api.ts); the auth state subscribes and signs out locally (endLocalSession in
 * src/lib/auth-context.tsx). Pure logic here, wiring there.
 */

/**
 * Whether an answer ends the current session: a 401 to a request that carried the current token.
 * A 401 to an older token (a request still in flight from before a new sign-in) changes nothing,
 * and requests without a token (sign-in, sign-up) never end a session.
 */
export function endsSession(status: number, requestToken: string | null | undefined, currentToken: string | null | undefined): boolean {
  return status === 401 && typeof requestToken === 'string' && requestToken !== '' && requestToken === currentToken;
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
