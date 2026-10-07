<?php

namespace App\Support;

use App\Models\TwoFactorChallenge;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Laravel\Sanctum\PersonalAccessToken;
use RuntimeException;

/**
 * Access tokens (Sanctum): the one place that issues and revokes them (F-20).
 *
 * Every token expires: issue() writes `expires_at` = now + the lifetime, Sanctum rejects a token
 * whose `expires_at` has passed or is missing (AppServiceProvider) or that is older than the
 * lifetime (config/sanctum.php), and Node's requireAuth (server/src/auth.js) applies the same
 * rule, the lifetime included: it reads SANCTUM_EXPIRATION too, so a lower value ends older
 * sessions on both backends at once. The lifetime's default and its accepted format are a named
 * mirror of server/src/config.js (scripts/ci/check-mirrors.mjs). Laravel is the only issuer; the
 * Node server only reads and deletes tokens.
 *
 * Revoking: a change of password, e-mail address or two-factor settings signs out every other
 * device (revokeOthers); a password reset, where nobody is signed in, signs out all (revokeAll).
 * Both also end every sign-in that has passed the password and still waits for its second factor
 * (a 'login' challenge): it is a session in the making, and whoever changes a credential to lock
 * someone out must not leave them a way in by the code.
 *
 * ## Sign-ins under way while a credential changes
 *
 * A sign-in checks a credential first and writes its token afterwards; a change that commits in
 * between must not leave a token behind that its revocation never saw. So no sign-in writes a
 * token outside the transaction that holds the account's row lock:
 *
 *   - the password sign-in (issueIfUnchanged) reads the account again under its row lock and
 *     writes the token in that transaction only if the columns in CREDENTIAL_COLUMNS still hold
 *     what the password check saw;
 *   - the two-factor sign-in writes its token in the transaction that locks the account's row,
 *     then the challenge's, and deletes the challenge (TwoFactor::attempt).
 *
 * Every change that revokes sessions writes the account's row before it revokes (that write
 * waits for the sign-in's lock), and a revocation deletes the open sign-ins before the tokens.
 * Against the password sign-in the comparison decides: a change whose write committed before the
 * sign-in's lock shows as a changed column, and one that waited for the lock writes, and revokes,
 * after the token exists. Against the two-factor sign-in the challenge decides: the revocation
 * either deletes it before the sign-in's transaction locks it (the sign-in finds it gone), or
 * waits for that transaction and then deletes the tokens, the new one included.
 * The changes, each with the column it writes before it revokes (pinned by
 * tests/Unit/SessionRevocationSitesTest.php):
 *
 *   - password reset and password change: `password`;
 *   - e-mail change: `email`;
 *   - two-factor switched on or off: `two_factor_method`; new recovery codes change only the
 *     codes, on an account whose sign-ins go through a challenge, which the revocation ends.
 *
 * Compared columns rather than a version number: every one of these changes writes one of them
 * already, so no new column is needed in the five copies of the schema (F-33).
 */
final class Sessions
{
    /**
     * The columns a password sign-in's check depends on: the hash it checked, the address it
     * found the account by, and two-factor sign-in being off (with it on, no token comes from
     * the password alone).
     */
    public const CREDENTIAL_COLUMNS = ['password', 'email', 'two_factor_method'];

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

    /**
     * A new token for an account whose password the caller has just checked against $checked
     * (the account as the caller read it), written only if the account still has those
     * credentials: read again under its row lock, compared column by column (CREDENTIAL_COLUMNS),
     * and the token written in the same transaction. Returns null, and writes nothing, when the
     * account is gone or one of the columns changed after the caller read it; the caller then
     * answers as for a wrong password.
     */
    public static function issueIfUnchanged(User $checked, mixed $deviceName): ?string
    {
        return DB::transaction(static function () use ($checked, $deviceName): ?string {
            $locked = User::whereKey($checked->getKey())->lockForUpdate()->first();
            if ($locked === null || ! self::sameCredentials($checked, $locked)) {
                return null;
            }

            return self::issue($locked, $deviceName);
        });
    }

    /** Do $a and $b hold the same stored values in every column of CREDENTIAL_COLUMNS? */
    private static function sameCredentials(User $a, User $b): bool
    {
        foreach (self::CREDENTIAL_COLUMNS as $column) {
            $left = $a->getRawOriginal($column);
            $right = $b->getRawOriginal($column);

            $same = $left === null || $right === null
                ? $left === $right
                : hash_equals((string) $left, (string) $right);
            if (! $same) {
                return false;
            }
        }

        return true;
    }

    /**
     * A new token for $user that expires after the lifetime; returns the bearer value. A sign-in
     * calls it only inside the transaction that holds the account's row lock (class comment).
     */
    public static function issue(User $user, mixed $deviceName): string
    {
        $name = is_string($deviceName) && trim($deviceName) !== ''
            ? mb_substr(trim($deviceName), 0, self::MAX_DEVICE_NAME)
            : 'mobile';

        // Sanctum writes the format the table already holds: "{id}|{40 characters}", stored as a
        // sha256 hex digest, abilities ["*"].
        return $user->createToken($name, ['*'], now()->addMinutes(self::lifetimeMinutes()))->plainTextToken;
    }

    /**
     * Deletes every token of $user except the one the current request is signed in with, and
     * every open sign-in; returns the number of tokens deleted.
     */
    public static function revokeOthers(User $user): int
    {
        self::endOpenSignIns($user);

        $current = $user->currentAccessToken();
        $currentId = $current instanceof PersonalAccessToken ? $current->getKey() : null;

        return $user->tokens()
            ->when($currentId !== null, fn ($query) => $query->whereKeyNot($currentId))
            ->delete();
    }

    /** Deletes every token of $user and every open sign-in; returns the number of tokens deleted. */
    public static function revokeAll(User $user): int
    {
        self::endOpenSignIns($user);

        return $user->tokens()->delete();
    }

    /**
     * Deletes the sign-ins of $user that wait for their second factor. Before the tokens: a
     * two-factor sign-in deletes its challenge and writes its token in one transaction, holding
     * the challenge's row lock (TwoFactor::attempt). This deletion either removes the challenge
     * first, and the sign-in finds it gone, or waits for that transaction, and the deletion of
     * the tokens that follows catches the token it wrote.
     */
    private static function endOpenSignIns(User $user): void
    {
        TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', TwoFactor::PURPOSE_LOGIN)
            ->delete();
    }
}
