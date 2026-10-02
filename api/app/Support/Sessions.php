<?php

namespace App\Support;

use App\Models\User;
use InvalidArgumentException;
use Laravel\Sanctum\PersonalAccessToken;
use RuntimeException;

/**
 * Access tokens (Sanctum): the one place that issues and revokes them (F-20).
 *
 * Every token expires: issue() writes `expires_at` = now + the lifetime, Sanctum rejects a token
 * whose `expires_at` has passed or is missing (AppServiceProvider) or that is older than the
 * lifetime (config/sanctum.php), and Node's requireAuth (server/src/auth.js) applies the same
 * `expires_at` rule. Laravel is the only issuer; the Node server only reads and deletes tokens.
 *
 * Revoking: a change of password, e-mail address or two-factor settings signs out every other
 * device (revokeOthers); a password reset, where nobody is signed in, signs out all (revokeAll).
 */
final class Sessions
{
    /** Default token lifetime: 30 days, absolute from sign-in; SANCTUM_EXPIRATION overrides it. */
    public const DEFAULT_LIFETIME_MINUTES = 43200;

    /** Longest name stored for a token (`device_name` comes from the client). */
    private const MAX_DEVICE_NAME = 100;

    /**
     * The lifetime from SANCTUM_EXPIRATION, in minutes. Unset or empty means the default; anything
     * but a positive whole number stops the configuration from loading. A typo must not end every
     * session after a minute, and it must never switch expiry off (Sanctum reads 0 and null as
     * "never").
     */
    public static function lifetimeFromEnv(mixed $raw): int
    {
        if ($raw === null || $raw === '') {
            return self::DEFAULT_LIFETIME_MINUTES;
        }

        if (is_int($raw) && $raw > 0) {
            return $raw;
        }

        if (is_string($raw) && preg_match('/^[1-9]\d{0,6}$/', trim($raw)) === 1) {
            return (int) trim($raw);
        }

        throw new InvalidArgumentException('SANCTUM_EXPIRATION must be a positive whole number of minutes.');
    }

    public static function lifetimeMinutes(): int
    {
        $minutes = config('sanctum.expiration');
        if (! is_int($minutes) || $minutes < 1) {
            throw new RuntimeException('sanctum.expiration must be a positive number of minutes (config/sanctum.php).');
        }

        return $minutes;
    }

    /** A new token for $user that expires after the lifetime; returns the bearer value. */
    public static function issue(User $user, mixed $deviceName): string
    {
        $name = is_string($deviceName) && trim($deviceName) !== ''
            ? mb_substr(trim($deviceName), 0, self::MAX_DEVICE_NAME)
            : 'mobile';

        // Sanctum writes the format the table already holds: "{id}|{40 characters}", stored as a
        // sha256 hex digest, abilities ["*"].
        return $user->createToken($name, ['*'], now()->addMinutes(self::lifetimeMinutes()))->plainTextToken;
    }

    /** Deletes every token of $user except the one the current request is signed in with. */
    public static function revokeOthers(User $user): int
    {
        $current = $user->currentAccessToken();
        $currentId = $current instanceof PersonalAccessToken ? $current->getKey() : null;

        return $user->tokens()
            ->when($currentId !== null, fn ($query) => $query->whereKeyNot($currentId))
            ->delete();
    }

    /** Deletes every token of $user. */
    public static function revokeAll(User $user): int
    {
        return $user->tokens()->delete();
    }
}
