import commonPasswords from '../../shared/common-passwords.json';

import { passwordStrength as rate, type PasswordStrength } from '@/domain/password-strength';

/**
 * Passwortstärke mit der Liste häufiger Passwörter, die auch der Server benutzt
 * (`shared/common-passwords.json`). Die reine Rechnung steht in
 * src/domain/password-strength.ts; hier kommt nur die Liste dazu, damit die
 * Domain-Datei ohne Metro testbar bleibt.
 */
export function passwordStrength(
  password: string,
  personal: (string | null | undefined)[] = [],
  /** Nur Benutzername und E-Mail – das prüft der Server (siehe PasswordContext.account). */
  account?: (string | null | undefined)[],
): PasswordStrength {
  return rate(password, { common: commonPasswords as string[], personal, account });
}

export type { PasswordStrength };
