/**
 * The e-mail address typed on "Passwort vergessen", handed to the reset screen in memory only.
 *
 * Not as a route parameter: on the web a parameter becomes part of the URL (browser history,
 * server logs, the Referer of the next request), and an address does not belong there. Not in
 * storage either: it is needed for the next screen only, and a restart may simply ask again.
 */
let draftEmail = '';
let draftJustSent = false;

/** Remembers the address; `justSent` when a code mail was requested for it a moment ago. */
export function rememberResetEmail(email: string, justSent = false): void {
  draftEmail = email.trim();
  draftJustSent = justSent;
}

/** The remembered address ('' when none); it stays until the next rememberResetEmail. */
export function peekResetEmail(): string {
  return draftEmail;
}

/** Whether the reset screen opens right after a code mail was requested (for its countdown). */
export function peekResetJustSent(): boolean {
  return draftJustSent;
}
