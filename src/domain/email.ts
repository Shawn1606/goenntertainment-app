/**
 * E-mail address check of the app (sign-up, forgot password) – the same rule as the server
 * (api/app/Support/EmailAddress.php), so the form never accepts what the server refuses.
 *
 * It accepts exactly what the former pattern `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepted, up to 254
 * characters, and rejects anything longer before looking at it. The former pattern backtracked
 * quadratically on long input (a pasted text froze the form); this check reads the string a fixed
 * number of times.
 *
 * Mirror differences that already existed with the former patterns: JavaScript counts the length
 * in UTF-16 units (PHP: code points) and its `\s` also covers Unicode spaces (PHP: ASCII only).
 */
export const EMAIL_MAX_LENGTH = 254;

/** One whitespace character; a single class without quantifier, so it cannot backtrack. */
const WHITESPACE = /\s/;

export function isEmailAddress(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > EMAIL_MAX_LENGTH) {
    return false;
  }
  if (WHITESPACE.test(value)) {
    return false;
  }
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) {
    return false;
  }
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot < domain.length - 1;
}
