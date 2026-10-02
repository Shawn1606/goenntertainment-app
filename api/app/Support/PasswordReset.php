<?php

namespace App\Support;

use App\Mail\PasswordResetCode;
use App\Models\TwoFactorChallenge;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Throwable;

use function Illuminate\Support\defer;

/**
 * Password reset by a one-time code (F-09): POST /forgot-password mails a 6-digit code to the
 * account's address, POST /reset-password takes the address, the code and the new password.
 * There is no reset link and no deep link; the code is typed into the app.
 *
 * ## Where the code lives
 *
 * A reset is a challenge in two_factor_challenges with purpose 'reset' (TwoFactor::PURPOSE_RESET),
 * like the other e-mail codes: the code only as an HMAC keyed with APP_KEY (TwoFactor::hashCode),
 * compared with hash_equals. The challenge's token is never handed out; the address finds the
 * account and the account its one open reset. password_reset_tokens is no longer used.
 *
 * ## The numbers (engineering defaults the operator may change)
 *
 *   - 6 digits, valid for 10 minutes (CODE_TTL);
 *   - 5 wrong codes and it is used up (MAX_ATTEMPTS), then a new one is needed;
 *   - at most one mail a minute per account (RESEND_AFTER); a new code replaces the previous one;
 *   - how many codes an account gets per hour and day is the route throttle of /forgot-password
 *     (config/ratelimits.php, password-forgot), and how many tries per hour that of
 *     /reset-password (password-reset). There is no second cap here.
 *
 * Wrong reset codes are counted on the challenge only. They do not feed the two-factor failure
 * cap (TwoFactor::attempt is not used): that cap guards the second factor, and a stranger who
 * knows nothing but the address must not be able to lock someone's sign-in codes by guessing
 * reset codes.
 *
 * ## One clock
 *
 * expires_at and last_sent_at are written and compared with PHP's clock (Eloquent), like every
 * other challenge, never with MySQL's NOW(): the two differ wherever APP_TIMEZONE is not the
 * database's time zone (the development default is Europe/Berlin, the test MySQL runs in UTC).
 *
 * ## Never logged
 *
 * The code exists in plain text only in the mail; it is never written to a log, not even when
 * the mail fails (CodeMail also refuses the log mailer). Log lines name the user id only.
 */
final class PasswordReset
{
    /** Valid for 10 minutes, like the other e-mail codes. */
    public const CODE_TTL = TwoFactor::CODE_TTL;

    /** At most one code mail a minute per account. */
    public const RESEND_AFTER = TwoFactor::RESEND_AFTER;

    /** After 5 wrong codes the code is used up. */
    public const MAX_ATTEMPTS = TwoFactor::MAX_ATTEMPTS;

    // Results of reset()
    public const OK = 'ok';

    /** No open code, expired, used up or wrong: one answer for all (no oracle). */
    public const INVALID = 'invalid';

    /** The code is right, but the password contains the username; the code stays valid. */
    public const PERSONAL = 'personal';

    /**
     * A new code for $user, mailed to the address stored for the account (never the spelling the
     * request used: under the column's collation a case or accent variant finds the same account,
     * but it could be someone else's mailbox). Returns silently, without a mail, within a minute
     * of the previous one.
     *
     * The mail goes out after the response (defer), so the answer to /forgot-password does not
     * wait for the mail server; where the server flushes the response first, its timing says
     * nothing about the address either. If the mail fails, the challenge is deleted (a code
     * nobody received is useless, and the next request may send at once) and the failure is
     * logged with the user id and the exception class.
     *
     * The account's row is read again under its lock: if its address changed after the request
     * looked it up (an e-mail change drops open reset codes in the same lock), the address asked
     * for no longer belongs to the account, and no code is made or mailed.
     */
    public static function issue(User $user): void
    {
        // Expired challenges of every account go first, on their own: inside the transaction
        // below their row locks would be held until its end.
        TwoFactor::pruneExpired();

        $issued = DB::transaction(function () use ($user): ?array {
            // One issue at a time per account: two requests at the same moment get one mail.
            $locked = self::lockAccount($user);
            if ($locked === null) {
                return null;
            }

            if (TwoFactor::secondsUntilNextMail($locked, TwoFactor::PURPOSE_RESET) > 0) {
                return null;
            }

            self::forget($locked);
            [$challenge] = TwoFactor::createChallenge($locked, TwoFactor::PURPOSE_RESET, TwoFactor::METHOD_EMAIL, prune: false);

            $code = sprintf('%06d', random_int(0, 999999));
            $challenge->forceFill([
                'code_hash' => TwoFactor::hashCode($challenge->token_hash, $code),
                'last_sent_at' => now(),
            ])->save();

            return [$challenge->getKey(), $code, (string) $locked->email];
        });

        if ($issued === null) {
            return;
        }

        [$challengeId, $code, $address] = $issued;
        $userId = $user->getKey();

        defer(static function () use ($challengeId, $code, $userId, $address): void {
            try {
                CodeMail::send($address, new PasswordResetCode($code, intdiv(self::CODE_TTL, 60)));
            } catch (Throwable $e) {
                TwoFactorChallenge::whereKey($challengeId)->delete();
                // The exception class only (F-38): a transport message can name the recipient.
                Log::error('[password-reset] code mail not sent', [
                    'user_id' => $userId,
                    'exception' => $e::class,
                ]);
            }
        });
    }

    /**
     * Sets $password for $user if $code is the account's open reset code. One transaction with
     * the challenge locked, so two requests with the same code cannot both use it, and every
     * wrong code is counted.
     *
     * On success: the new password, every open reset code gone, and every session ended
     * (Sessions::revokeAll: all tokens and every sign-in waiting for its second factor), a
     * sign-in under way at this moment included (Sessions, "Sign-ins under way"). Whoever
     * resets a password may be locking out someone who knew the old one.
     *
     * The username rule is checked only after the code matched (before, its message would tell a
     * stranger that the address has an account, and what its username contains); a password that
     * breaks it does not use the code up.
     *
     * Locks are taken in one order, the account's row first and then its challenges, as issue()
     * and the e-mail change do: the other order could deadlock with a new code being issued at
     * the same moment. As in issue(), an address that no longer belongs to the account finds no
     * code.
     */
    public static function reset(User $user, string $code, string $password): string
    {
        return DB::transaction(function () use ($user, $code, $password): string {
            $locked = self::lockAccount($user);
            if ($locked === null) {
                return self::INVALID;
            }

            $challenge = TwoFactorChallenge::where('user_id', $locked->getKey())
                ->where('purpose', TwoFactor::PURPOSE_RESET)
                ->orderByDesc('id')
                ->lockForUpdate()
                ->first();

            if ($challenge === null
                || $challenge->isExpired()
                || ! is_string($challenge->code_hash)
                || $challenge->attempts >= self::MAX_ATTEMPTS) {
                return self::INVALID;
            }

            if (! hash_equals($challenge->code_hash, TwoFactor::hashCode($challenge->token_hash, $code))) {
                $challenge->increment('attempts');

                return self::INVALID;
            }

            if (PasswordPolicy::problem($password, $locked->username, $locked->email) !== null) {
                return self::PERSONAL;
            }

            $locked->forceFill([
                'password' => Hash::make($password),
                'remember_token' => null,
            ])->save();

            self::forget($locked);
            Sessions::revokeAll($locked);

            return self::OK;
        });
    }

    /**
     * The account's row, read again and locked for the rest of the transaction; null when it is
     * gone or no longer has the address $user was found by.
     */
    private static function lockAccount(User $user): ?User
    {
        $locked = User::whereKey($user->getKey())->lockForUpdate()->first();

        return $locked !== null && (string) $locked->email === (string) $user->email ? $locked : null;
    }

    /** Deletes every open reset code of $user (a new code, a reset, a password or e-mail change). */
    public static function forget(User $user): void
    {
        TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', TwoFactor::PURPOSE_RESET)
            ->delete();
    }
}
