<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * Proof that the person at the keyboard owns the account, asked again before a security change
 * (F-04, F-19): the current password, and for some changes the current second-factor code too. A
 * stolen or forgotten-open session alone is not enough to change the e-mail address or the
 * two-factor settings.
 *
 * The password comes first: a second-factor code is used up when it is checked (a recovery code
 * for good), so it must not be lost to a typo in the password.
 */
final class StepUp
{
    public const MSG_PASSWORD_REQUIRED = 'Bitte bestätige mit deinem Passwort.';

    public const MSG_NO_PASSWORD = 'Lege zuerst ein Passwort fest – unter Einstellungen → Passwort ändern.';

    public static function hasPassword(User $user): bool
    {
        return is_string($user->password) && $user->password !== '';
    }

    /**
     * The account's current password, given in $field. Accounts without a password (created by the
     * removed Google sign-in) must set one first: a session alone proves nothing.
     */
    public static function assertPassword(User $user, mixed $password, string $field = 'password'): void
    {
        if (! self::hasPassword($user)) {
            throw ValidationException::withMessages([$field => [self::MSG_NO_PASSWORD]]);
        }

        if (! is_string($password) || $password === '') {
            throw ValidationException::withMessages([$field => [self::MSG_PASSWORD_REQUIRED]]);
        }

        if (! Passwords::check($password, $user->password)) {
            throw ValidationException::withMessages([$field => [TwoFactor::MSG_PASSWORD_WRONG]]);
        }
    }

    /**
     * Password (when the account has one) AND the current second-factor code, for switching
     * two-factor sign-in off and for new recovery codes. Either one alone was enough before: a
     * stolen session with a mailed code, or the password alone, could switch it off.
     */
    public static function assertPasswordAndCode(User $user, mixed $password, mixed $code): void
    {
        if (self::hasPassword($user)) {
            self::assertPassword($user, $password);
        }

        TwoFactor::assertCode($user, $code);
    }
}
