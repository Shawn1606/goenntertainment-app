<?php

namespace App\Support;

use App\Http\Controllers\PasswordController;
use App\Mail\EmailChangeCode;
use App\Models\TwoFactorChallenge;
use App\Models\User;
use Closure;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Throwable;

/**
 * One-time codes that prove, while signed in, that the person can read the mail of an address
 * (F-04). A change that waits for one:
 *
 *   - an e-mail change (TwoFactor::PURPOSE_NEW_EMAIL): the code goes to the NEW address, and the
 *     address takes effect only with it, so an account can only move to an address whose mail
 *     its owner reads (AccountController::updateEmail, ::confirmEmail).
 *
 * ## Where the code lives
 *
 * A challenge in two_factor_challenges with that purpose, like the other e-mail codes, so no
 * table changes. The code is kept only as an HMAC keyed with APP_KEY that covers the challenge
 * AND the address the code was mailed to (TwoFactor::hashAddressCode): the address is not
 * stored, the confirming request names it again, and a code confirms the address it was sent to
 * and no other. The challenge's token is never handed out; the signed-in account finds its one
 * open code of the purpose.
 *
 * ## The numbers
 *
 * Those of the other e-mail codes (TwoFactor): 6 digits, valid for 10 minutes, used up after 5
 * wrong codes, at most one mail a minute per account and purpose; a new code replaces the
 * previous one. A code is checked through TwoFactor::attempt, so wrong codes also count toward
 * the account's cap of wrong codes (config ratelimits.two-factor-failures), as for every other
 * code a signed-in account types. How many requests an account gets is the route throttle's
 * (account-sensitive).
 *
 * ## Never logged
 *
 * The code exists in plain text only in the mail, which goes through CodeMail (never the log
 * mailer). A mail that cannot be sent is logged with the user id and the exception class only,
 * and its code is deleted: nobody received it.
 */
final class AddressCode
{
    /** The log prefix of each purpose; also the list of purposes this class serves. */
    private const LOG_PREFIX = [
        TwoFactor::PURPOSE_NEW_EMAIL => '[email-change]',
    ];

    /**
     * Seconds until a new code of $purpose may be mailed to $user (0 = now). The e-mail change
     * asks before it checks the second-factor code, which a refused request must not use up.
     */
    public static function secondsUntilNextMail(User $user, string $purpose): int
    {
        self::assertPurpose($purpose);

        return TwoFactor::secondsUntilNextMail($user, $purpose);
    }

    /**
     * A new code of $purpose for $user, mailed to $address; the previous open one of the purpose
     * is gone. Throws the 429 answer (with `retry_after`) within a minute of the previous mail,
     * and the 503 answer when the mail cannot be sent.
     */
    public static function send(User $user, string $purpose, string $address): void
    {
        self::assertPurpose($purpose);

        // Expired challenges of every account go first, on their own: inside the transaction
        // below their row locks would be held until its end (as in PasswordReset).
        TwoFactor::pruneExpired();

        $made = DB::transaction(function () use ($user, $purpose, $address): array|int {
            // One code at a time per account: two requests at the same moment get one mail.
            $locked = User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            $wait = TwoFactor::secondsUntilNextMail($locked, $purpose);
            if ($wait > 0) {
                return $wait;
            }

            self::forget($locked, $purpose);
            [$challenge] = TwoFactor::createChallenge($locked, $purpose, TwoFactor::METHOD_EMAIL, prune: false);

            $code = sprintf('%06d', random_int(0, 999999));
            $challenge->forceFill([
                'code_hash' => TwoFactor::hashAddressCode($challenge->token_hash, $code, $address),
                'last_sent_at' => now(),
            ])->save();

            return [(int) $challenge->getKey(), $code];
        });

        if (is_int($made)) {
            throw new HttpResponseException(self::waitResponse($made));
        }

        [$challengeId, $code] = $made;

        try {
            CodeMail::send($address, self::mail($purpose, $code));
        } catch (Throwable $e) {
            TwoFactorChallenge::whereKey($challengeId)->delete();
            // The exception class only (F-38): a transport message can name the recipient.
            Log::error(self::LOG_PREFIX[$purpose].' code mail not sent', [
                'user_id' => $user->getKey(),
                'exception' => $e::class,
            ]);

            throw new HttpResponseException(response()->json(['message' => TwoFactor::MSG_MAIL_FAILED], 503));
        }
    }

    /**
     * Checks $code against the open code of $purpose for $user that was mailed to $address. With
     * the right code, $apply runs with the account's row (locked) in the transaction that uses
     * the code up (TwoFactor::attempt): if it throws, that transaction is rolled back, nothing
     * changes and the code stays valid. Otherwise throws a 422 on $field: a code that is not six
     * digits (not counted), no open code, an expired, wrong or used-up code, or the account's
     * cap of wrong codes reached.
     *
     * @param  Closure(User): void  $apply
     */
    public static function confirm(User $user, string $purpose, string $address, mixed $code, Closure $apply, string $field = 'code'): void
    {
        self::assertPurpose($purpose);

        $typed = is_scalar($code) ? trim((string) $code) : '';
        if ($typed === '') {
            throw ValidationException::withMessages([$field => [TwoFactor::MSG_CODE_REQUIRED]]);
        }

        $otp = strlen($typed) <= 20 ? TwoFactor::normalizeOtp($typed) : null;
        if ($otp === null) {
            // A typo in the shape is refused before anything is looked up, and costs no attempt.
            throw ValidationException::withMessages([$field => [PasswordController::MSG_CODE_SHAPE]]);
        }

        $challenge = TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', $purpose)
            ->latest('id')
            ->first();

        if ($challenge === null) {
            throw ValidationException::withMessages([$field => [TwoFactor::MSG_EXPIRED]]);
        }

        $result = TwoFactor::attempt(
            $challenge,
            static fn (TwoFactorChallenge $locked): bool => is_string($locked->code_hash)
                && hash_equals($locked->code_hash, TwoFactor::hashAddressCode($locked->token_hash, $otp, $address)),
            $apply,
        );

        $message = match ($result) {
            TwoFactor::OK => null,
            TwoFactor::WRONG => TwoFactor::MSG_WRONG,
            TwoFactor::TOO_MANY => TwoFactor::MSG_TOO_MANY,
            TwoFactor::LOCKED => TwoFactor::lockedMessage($user->getKey()),
            default => TwoFactor::MSG_EXPIRED,
        };

        if ($message !== null) {
            throw ValidationException::withMessages([$field => [$message]]);
        }
    }

    /** Deletes the open codes of $purpose of $user. */
    public static function forget(User $user, string $purpose): void
    {
        self::assertPurpose($purpose);

        TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', $purpose)
            ->delete();
    }

    /** 429 with the wait, as a number for the app and as a header for everything else. */
    public static function waitResponse(int $seconds): JsonResponse
    {
        return response()
            ->json(['message' => TwoFactor::MSG_RESEND_WAIT, 'retry_after' => $seconds], 429)
            ->header('Retry-After', (string) $seconds);
    }

    private static function mail(string $purpose, string $code): Mailable
    {
        return new EmailChangeCode($code, intdiv(TwoFactor::CODE_TTL, 60));
    }

    private static function assertPurpose(string $purpose): void
    {
        if (! array_key_exists($purpose, self::LOG_PREFIX)) {
            throw new InvalidArgumentException("Not a purpose of AddressCode: {$purpose}");
        }
    }
}
