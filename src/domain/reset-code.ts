import { isEmailAddress } from './email.ts';

/**
 * Password reset by a one-time code (F-09): "Passwort vergessen" mails a 6-digit code, and the
 * reset screen sends it with the e-mail address and the new password to POST /reset-password.
 * There is no reset link and no deep link.
 *
 * The same shape rule as the server (api/app/Http/Controllers/PasswordController.php, reset):
 * six digits, spaces allowed ("123 456", as many apps show it). Everything else is refused here
 * before it is sent, so a typo never costs one of the code's five attempts.
 */
export const RESET_CODE_LENGTH = 6;

/** Seconds between two code mails for one account; the server enforces it (PasswordReset). */
export const RESET_RESEND_SECONDS = 60;

/** The code as six digits, or null when the input is not a 6-digit code. */
export function normalizeResetCode(input: string): string | null {
  const clean = input.replace(/\s+/g, '');
  return /^\d{6}$/.test(clean) ? clean : null;
}

export type ResetForm = {
  email: string;
  code: string;
  password: string;
  repeat: string;
};

export type ResetFormProblem = {
  field: 'email' | 'code' | 'password' | 'repeat';
  message: string;
};

export const MSG_RESET_EMAIL = 'Bitte gib eine gültige E-Mail-Adresse ein.';
export const MSG_RESET_CODE = 'Bitte gib den 6-stelligen Code aus der E-Mail ein.';
export const MSG_RESET_PASSWORD = 'Bitte gib ein neues Passwort ein.';
export const MSG_RESET_MISMATCH = 'Die beiden Passwörter sind nicht gleich.';

/**
 * The first problem of the reset form, in the order of its fields, or null when it can be sent.
 * Whether the new password meets the rule is the strength meter's and the server's call
 * (PasswordPolicy); here only "something was typed, twice the same".
 */
export function resetFormProblem(form: ResetForm): ResetFormProblem | null {
  if (!isEmailAddress(form.email.trim())) {
    return { field: 'email', message: MSG_RESET_EMAIL };
  }
  if (normalizeResetCode(form.code) === null) {
    return { field: 'code', message: MSG_RESET_CODE };
  }
  if (form.password.length === 0) {
    return { field: 'password', message: MSG_RESET_PASSWORD };
  }
  if (form.repeat !== form.password) {
    return { field: 'repeat', message: MSG_RESET_MISMATCH };
  }
  return null;
}
