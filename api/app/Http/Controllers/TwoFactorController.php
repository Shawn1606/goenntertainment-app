<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Mail\AccountSecurityNotice;
use App\Models\TwoFactorChallenge;
use App\Models\User;
use App\Support\Sessions;
use App\Support\StepUp;
use App\Support\Totp;
use App\Support\TwoFactor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Zwei-Faktor-Anmeldung: der zweite Schritt beim Anmelden und das Ein-/Ausschalten.
 *
 * Die Logik liegt in App\Support\TwoFactor; hier stehen nur die Endpunkte und
 * welche Meldung wann kommt.
 *
 * ## Ein Signal fuer die App: `errors.challenge` vs. `errors.code`
 *
 * Beim Anmelden gibt es zwei Sorten Fehler, und die App muss sie
 * unterscheiden: „Tippfehler, nochmal" (Feld `code`) und „dieser Vorgang ist
 * tot, zurueck zum Passwort" (Feld `challenge` - abgelaufen oder zu viele
 * Versuche). Beides ist 422, die Meldung ist fuer Menschen, das Feld fuer die App.
 */
class TwoFactorController extends Controller
{
    /* ------------------------------------------------------------ Anmeldung */

    /** POST /api/login/two-factor {challenge, code, device_name?} */
    public function verifyLogin(Request $request): JsonResponse
    {
        $this->requireFields($request, ['challenge' => TwoFactor::MSG_EXPIRED_LOGIN, 'code' => TwoFactor::MSG_CODE_REQUIRED]);

        $challenge = TwoFactor::findChallenge($request->input('challenge'), TwoFactor::PURPOSE_LOGIN);
        $user = $challenge?->user;

        // 2FA inzwischen ausgeschaltet? Dann gehoert der Vorgang zu nichts mehr
        // (disable() raeumt ihn zwar weg, aber ein Wettlauf ist denkbar).
        if ($challenge === null || $user === null || ! TwoFactor::isEnabled($user)) {
            throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_EXPIRED_LOGIN]]);
        }

        /**
         * Gesperrt? Dieselbe Antwort wie bei POST /login - VOR dem Code, damit
         * dabei nichts verbraucht wird (kein Wiederherstellungscode, kein
         * Versuch). Wer bis hier kam, hat das Passwort bewiesen; mehr als das,
         * was /login an dieser Stelle schon zeigt, erfaehrt niemand.
         */
        if ($user->isBanned()) {
            return response()->json([
                'message' => 'Dein Konto ist gesperrt.',
                'ban' => $user->banInfo(),
            ], 403);
        }

        $code = (string) $request->input('code');

        $result = TwoFactor::attempt(
            $challenge,
            fn (TwoFactorChallenge $locked) => TwoFactor::challengeCodeMatches($locked, $user, $code, true),
        );

        match ($result) {
            TwoFactor::OK => null,
            TwoFactor::WRONG => throw ValidationException::withMessages(['code' => [TwoFactor::MSG_WRONG]]),
            TwoFactor::TOO_MANY => throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_TOO_MANY_LOGIN]]),
            // The account's cap (F-19): back to the password form, with the time to wait.
            TwoFactor::LOCKED => throw ValidationException::withMessages(['challenge' => [TwoFactor::lockedMessage($user->getKey())]]),
            default => throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_EXPIRED_LOGIN]]),
        };

        return $this->tokenResponse($request, $user->refresh());
    }

    /** POST /api/login/two-factor/resend {challenge} - nur fuer die E-Mail-Methode. */
    public function resendLogin(Request $request): JsonResponse
    {
        $this->requireFields($request, ['challenge' => TwoFactor::MSG_EXPIRED_LOGIN]);

        $challenge = TwoFactor::findChallenge($request->input('challenge'), TwoFactor::PURPOSE_LOGIN);
        $user = $challenge?->user;

        $tooOld = $challenge !== null
            && $challenge->created_at !== null
            && $challenge->created_at->lessThan(now()->subSeconds(TwoFactor::MAX_AGE));

        if ($challenge === null || $user === null || $challenge->isExpired() || $tooOld) {
            throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_EXPIRED_LOGIN]]);
        }

        if ($challenge->attempts >= TwoFactor::MAX_ATTEMPTS) {
            throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_TOO_MANY_LOGIN]]);
        }

        // Bei TOTP gibt es nichts zu senden - ein Konflikt, kein Eingabefehler.
        if ($challenge->method !== TwoFactor::METHOD_EMAIL) {
            return response()->json(['message' => TwoFactor::MSG_USES_APP], 409);
        }

        // At the account's cap no code is mailed either (F-19).
        TwoFactor::refuseIfLocked($user, 'challenge');

        $wait = TwoFactor::claimResend($challenge);
        if ($wait !== null) {
            return $this->waitResponse($wait);
        }

        TwoFactor::sendCode($challenge->refresh(), $user);

        $destination = TwoFactor::maskEmail((string) $user->email);

        return response()->json([
            'message' => "Wir haben dir einen neuen Code an {$destination} geschickt.",
            'destination' => $destination,
            'expires_in' => TwoFactor::CODE_TTL,
        ]);
    }

    /* ------------------------------------------------ Einschalten per E-Mail */

    /**
     * POST /api/user/two-factor/email {password} - Code an die Konto-Adresse.
     *
     * The password first (F-19): a session alone must not be able to put its own second factor
     * in front of the account. No code is mailed without it.
     */
    public function startEmail(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfActive($user);
        StepUp::assertPassword($user, $request->input('password'));

        $wait = TwoFactor::secondsUntilNextMail($user, TwoFactor::PURPOSE_SETUP);
        if ($wait > 0) {
            return $this->waitResponse($wait);
        }

        // Eine Einrichtung zur Zeit: Der Code der vorigen Mail soll nicht mehr gelten.
        TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', TwoFactor::PURPOSE_SETUP)
            ->delete();

        [$challenge, $token] = TwoFactor::createChallenge($user, TwoFactor::PURPOSE_SETUP, TwoFactor::METHOD_EMAIL);
        TwoFactor::sendCode($challenge, $user);

        $destination = TwoFactor::maskEmail((string) $user->email);

        return response()->json([
            'message' => "Wir haben dir einen Code an {$destination} geschickt.",
            'destination' => $destination,
            'expires_in' => TwoFactor::CODE_TTL,
            'challenge' => $token,
        ]);
    }

    /** POST /api/user/two-factor/email/confirm {challenge, code} */
    public function confirmEmail(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfActive($user);
        $this->requireFields($request, ['challenge' => TwoFactor::MSG_EXPIRED, 'code' => TwoFactor::MSG_CODE_REQUIRED]);

        $challenge = TwoFactor::findChallenge($request->input('challenge'), TwoFactor::PURPOSE_SETUP, (int) $user->getKey());
        if ($challenge === null) {
            throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_EXPIRED]]);
        }

        $code = (string) $request->input('code');

        // Beim Einschalten zaehlt nur der gemailte Code - Wiederherstellungscodes
        // gibt es ja erst danach.
        $result = TwoFactor::attempt(
            $challenge,
            fn (TwoFactorChallenge $locked) => TwoFactor::challengeCodeMatches($locked, $user, $code, false),
        );

        match ($result) {
            TwoFactor::OK => null,
            TwoFactor::WRONG => throw ValidationException::withMessages(['code' => [TwoFactor::MSG_WRONG]]),
            TwoFactor::TOO_MANY => throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_TOO_MANY]]),
            TwoFactor::LOCKED => throw ValidationException::withMessages(['code' => [TwoFactor::lockedMessage($user->getKey())]]),
            default => throw ValidationException::withMessages(['challenge' => [TwoFactor::MSG_EXPIRED]]),
        };

        $codes = TwoFactor::enable($user, TwoFactor::METHOD_EMAIL);
        $this->afterChange($user, AccountSecurityNotice::TWO_FACTOR_ENABLED);

        return response()->json([
            'user' => $this->userPayload($request, $user),
            'recovery_codes' => $codes,
        ]);
    }

    /* ------------------------------------------ Einschalten per Authenticator */

    /**
     * POST /api/user/two-factor/totp - neues Secret, noch NICHT aktiv.
     *
     * Aktiv wird es erst mit einem passenden Code (…/totp/confirm). Bis dahin
     * steht es als angefangene Einrichtung am Konto; ein erneuter Aufruf
     * ersetzt es - wer den QR-Code nicht erwischt hat, faengt einfach neu an.
     */
    public function startTotp(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfActive($user);
        // The password first (F-19): no secret is made or stored without it.
        StepUp::assertPassword($user, $request->input('password'));

        $secret = Totp::generateSecret();

        // Ohne `updated_at`: Eine angefangene Einrichtung aendert am Konto nichts.
        $user->timestamps = false;
        $user->forceFill(['two_factor_secret' => $secret])->save();
        $user->timestamps = true;

        return response()->json([
            'secret' => $secret,
            'otpauth_url' => Totp::otpauthUrl($secret, (string) $user->email, TwoFactor::ISSUER),
        ]);
    }

    /** POST /api/user/two-factor/totp/confirm {code} */
    public function confirmTotp(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfActive($user);
        $this->requireFields($request, ['code' => TwoFactor::MSG_CODE_REQUIRED]);

        $secret = $user->two_factor_secret;
        if (! is_string($secret) || $secret === '') {
            throw ValidationException::withMessages(['code' => [TwoFactor::MSG_SETUP_RESTART]]);
        }

        // Wrong app codes during the setup count toward the account's cap too (F-19): looked at,
        // checked and counted under the account's lock (TwoFactor::withAccountLock).
        $code = (string) $request->input('code');
        $step = TwoFactor::withAccountLock($user->getKey(), function () use ($user, $secret, $code): int {
            TwoFactor::refuseIfLocked($user, 'code');

            $step = Totp::verify($secret, $code);
            if ($step === null) {
                TwoFactor::recordFailure($user->getKey());

                throw ValidationException::withMessages(['code' => [TwoFactor::MSG_WRONG]]);
            }

            return $step;
        });

        // Das Fenster des Bestaetigungs-Codes gilt schon als verbraucht: Derselbe
        // Code kann nicht gleich danach noch eine Anmeldung freischalten.
        $codes = TwoFactor::enable($user, TwoFactor::METHOD_TOTP, $step, $secret);
        $this->afterChange($user, AccountSecurityNotice::TWO_FACTOR_ENABLED);

        return response()->json([
            'user' => $this->userPayload($request, $user),
            'recovery_codes' => $codes,
        ]);
    }

    /* ---------------------------------------------------------- Verwalten */

    /**
     * DELETE /api/user/two-factor {password, code}
     *
     * Password AND current code (F-19): before, either alone was enough - a stolen session with a
     * mailed code, or the password alone, could switch the second factor off.
     */
    public function disable(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfInactive($user);

        StepUp::assertPasswordAndCode($user, $request->input('password'), $request->input('code'));
        TwoFactor::disable($user);
        $this->afterChange($user, AccountSecurityNotice::TWO_FACTOR_DISABLED);

        return response()->json(['user' => $this->userPayload($request, $user->refresh())]);
    }

    /** POST /api/user/two-factor/recovery-codes {password, code} - neue Codes, alte ungueltig. */
    public function regenerateRecoveryCodes(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfInactive($user);

        StepUp::assertPasswordAndCode($user, $request->input('password'), $request->input('code'));
        $codes = TwoFactor::replaceRecoveryCodes($user);
        $this->afterChange($user, AccountSecurityNotice::RECOVERY_CODES_RENEWED);

        return response()->json(['recovery_codes' => $codes]);
    }

    /**
     * After a two-factor change (F-19, F-20): every other session is signed out, and the account
     * gets a notice. The notice is best effort: the change was proven with the password (and the
     * code), so a mail that cannot be sent is logged (user id and exception class only) and does
     * not undo it - unlike the e-mail change, where the notice is the only signal.
     */
    private function afterChange(User $user, string $kind): void
    {
        Sessions::revokeOthers($user);

        try {
            Mail::to($user->email)->send(new AccountSecurityNotice($kind));
        } catch (\Throwable $e) {
            Log::error('[two-factor] security notice not sent', ['user_id' => $user->getKey(), 'exception' => $e::class]);
        }
    }

    /**
     * POST /api/user/two-factor/code - Code per Mail fuer eine heikle Aktion.
     *
     * Nur fuer die E-Mail-Methode. Wer sie nutzt, hat sonst keinen Weg zu dem
     * „aktuellen Code", den Ausschalten, neue Wiederherstellungscodes und das
     * Loeschen des Kontos verlangen - die Einrichtungs-Mail (…/email) ist bei
     * aktiver 2FA ja gesperrt. Geprueft wird der Code dann ueber das Feld `code`
     * jener Endpunkte; einen Vorgangs-Token braucht die App dafuer nicht, der
     * Code haengt am angemeldeten Konto.
     */
    public function sendConfirmCode(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->refuseIfInactive($user);

        if ($user->two_factor_method !== TwoFactor::METHOD_EMAIL) {
            return response()->json(['message' => TwoFactor::MSG_USES_APP], 409);
        }

        $wait = TwoFactor::secondsUntilNextMail($user, TwoFactor::PURPOSE_CONFIRM);
        if ($wait > 0) {
            return $this->waitResponse($wait);
        }

        TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', TwoFactor::PURPOSE_CONFIRM)
            ->delete();

        [$challenge] = TwoFactor::createChallenge($user, TwoFactor::PURPOSE_CONFIRM, TwoFactor::METHOD_EMAIL);
        TwoFactor::sendCode($challenge, $user);

        $destination = TwoFactor::maskEmail((string) $user->email);

        return response()->json([
            'message' => "Wir haben dir einen Code an {$destination} geschickt.",
            'destination' => $destination,
            'expires_in' => TwoFactor::CODE_TTL,
        ]);
    }

    /* ------------------------------------------------------------ Helfer */

    /**
     * Pflichtfelder mit eigener Meldung je Feld - in der angegebenen Reihenfolge,
     * damit `message` die erste fehlende Angabe nennt.
     *
     * Ein Code darf als Zahl kommen (JSON `123456`), deshalb `scalar` statt
     * `string`; zu Text wird er beim Lesen.
     */
    private function requireFields(Request $request, array $fields): void
    {
        $rules = [];
        $messages = [];

        foreach ($fields as $field => $message) {
            $rules[$field] = ['bail', 'required', function (string $attribute, mixed $value, \Closure $fail) use ($message) {
                if (! is_scalar($value) || trim((string) $value) === '') {
                    $fail($message);
                }
            }];
            $messages["{$field}.required"] = $message;
        }

        Validator::make($request->all(), $rules, $messages)->validate();
    }

    private function refuseIfActive(User $user): void
    {
        if ($user->two_factor_method !== null) {
            throw TwoFactor::conflict(TwoFactor::MSG_ALREADY_ACTIVE);
        }
    }

    private function refuseIfInactive(User $user): void
    {
        if (! TwoFactor::isEnabled($user)) {
            throw TwoFactor::conflict(TwoFactor::MSG_NOT_ACTIVE);
        }
    }

    /** 429 mit Wartezeit - als Zahl fuer die App und als Kopfzeile fuer alles andere. */
    private function waitResponse(int $seconds): JsonResponse
    {
        return response()
            ->json(['message' => TwoFactor::MSG_RESEND_WAIT, 'retry_after' => $seconds], 429)
            ->header('Retry-After', (string) $seconds);
    }

    private function userPayload(Request $request, User $user): array
    {
        return (new UserResource($user))->withInterests()->toArray($request);
    }

    /**
     * Dasselbe Format wie nach POST /login (AuthController::tokenResponse):
     * `user` mit Kategorien, `token`, `profile_complete`.
     */
    private function tokenResponse(Request $request, User $user): JsonResponse
    {
        $token = Sessions::issue($user, $request->input('device_name'));

        return response()->json([
            'user' => $this->userPayload($request, $user),
            'token' => $token,
            'profile_complete' => $user->profileComplete(),
        ]);
    }
}
