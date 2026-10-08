<?php

namespace App\Http\Controllers;

use App\Http\Responses\LengthDelimitedJsonResponse;
use App\Models\User;
use App\Rules\ValidEmail;
use App\Support\PasswordPolicy;
use App\Support\PasswordReset;
use App\Support\TwoFactor;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Passwort vergessen und zuruecksetzen - by a one-time code sent by e-mail and typed into the app
 * (F-09). No reset link, no deep link. The code's rules (6 digits, 10 minutes, 5 attempts, a
 * minute between mails) and why: App\Support\PasswordReset.
 *
 * ## Warum nicht Laravels Password-Broker
 *
 * Laravel bringt das fertig mit - aber mit eigenen Meldungen, eigenen Status-Namen
 * ('passwords.sent'). Its broker also resets by a link token, while here the reset is a code
 * typed into the app. Die App liest `status` und zeigt `message` woertlich an, so the answers
 * keep the form they had before.
 *
 * password_reset_tokens (the former link tokens) is no longer read or written; the table stays
 * in the schema until its removal (backlog).
 */
class PasswordController extends Controller
{
    private const MSG_EMAIL = ValidEmail::MESSAGE;

    /** The neutral answer to /forgot-password, whether or not the address has an account. */
    public const MSG_SENT = 'Falls ein Konto zu dieser Adresse existiert, haben wir dir einen Code geschickt.';

    /** A code that is not six digits (or missing); said before anything is looked up. */
    public const MSG_CODE_SHAPE = 'Bitte gib den 6-stelligen Code aus der E-Mail ein.';

    /** Wrong, expired, used up, no code requested, or no such account: one answer for all. */
    public const MSG_CODE_INVALID = 'Der Code ist ungültig oder abgelaufen. Fordere bei Bedarf einen neuen an.';

    /**
     * POST /api/forgot-password {email}
     *
     * Antwortet IMMER neutral - so verraet die API nicht, ob eine E-Mail
     * registriert ist. Das ist der ganze Zweck der Gleichbehandlung: Wer hier
     * Adressen durchprobiert, lernt nichts. The same answer within a minute of the last
     * code mail, when no new mail goes out. How many requests an account gets is the route
     * throttle's (password-forgot).
     *
     * Nor does the timing tell (F-21): up to the answer a known address costs what an unknown
     * one costs, the lookup below; the code is made and mailed after the answer, which the
     * client has completely before that (PasswordReset::issue, LengthDelimitedJsonResponse).
     */
    public function forgot(Request $request): JsonResponse
    {
        Validator::make($request->all(), [
            'email' => ['bail', 'required', new ValidEmail],
        ], [
            'email.required' => self::MSG_EMAIL,
        ])->validate();

        $user = User::where('email', (string) $request->input('email'))->first();

        if ($user !== null) {
            PasswordReset::issue($user);
        }

        return new LengthDelimitedJsonResponse([
            'status' => 'sent',
            'message' => self::MSG_SENT,
        ]);
    }

    /**
     * POST /api/reset-password {email, code, password, password_confirmation?}
     *
     * Sets a new password with the right code and uses the code up (single use); every session of
     * the account ends. A request with the former link `token` and no `code` fails on `code`.
     */
    public function reset(Request $request): JsonResponse
    {
        Validator::make($request->all(), [
            'email' => ['bail', 'required', new ValidEmail],
            'code' => ['bail', 'required', $this->codeRule()],
            'password' => ['bail', 'required', $this->passwordRule($request), $this->confirmationRule($request)],
        ], [
            'email.required' => self::MSG_EMAIL,
            'code.required' => self::MSG_CODE_SHAPE,
            'password.required' => 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.',
        ])->validate();

        $user = User::where('email', (string) $request->input('email'))->first();
        $code = (string) TwoFactor::normalizeOtp((string) $request->input('code'));

        $result = $user === null
            ? PasswordReset::INVALID
            : PasswordReset::reset($user, $code, (string) $request->input('password'));

        /**
         * The username in the password is checked only NOW, with a valid code
         * (PasswordReset::reset checks it after the code matched, and the code stays valid).
         *
         * In der Validierung oben waere die Meldung ein Orakel: Wer zu einer
         * fremden Adresse Passwoerter durchprobiert, erfuehre aus „darf deinen
         * Benutzernamen nicht enthalten", dass es das Konto gibt - und Stueck fuer
         * Stueck, wie es heisst. Genau das soll die neutrale Antwort von
         * forgot() verhindern. Grundregel, Liste und E-Mail-Teil haengen an
         * nichts Geheimem und stehen deshalb schon oben.
         */
        return match ($result) {
            PasswordReset::OK => response()->json([
                'status' => 'reset',
                'message' => 'Dein Passwort wurde zurueckgesetzt.',
            ]),
            PasswordReset::PERSONAL => throw ValidationException::withMessages(['password' => [PasswordPolicy::MSG_PERSONAL]]),
            default => throw ValidationException::withMessages(['code' => [self::MSG_CODE_INVALID]]),
        };
    }

    /** Six digits, spaces allowed ("123 456"); checked before anything is looked up. */
    private function codeRule(): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_string($value) || strlen($value) > 20 || TwoFactor::normalizeOtp($value) === null) {
                $fail(self::MSG_CODE_SHAPE);
            }
        };
    }

    /**
     * Dieselbe Regel wie bei der Registrierung (App\Support\PasswordPolicy) -
     * hier zunaechst nur mit dem E-Mail-Teil; the username is added only after the code check
     * (reason in reset()).
     */
    private function passwordRule(Request $request): Closure
    {
        $email = $request->input('email');

        return PasswordPolicy::rule(null, is_string($email) ? $email : null);
    }

    /**
     * Bestaetigung nur pruefen, wenn sie mitgeschickt wurde.
     *
     * Nicht `confirmed`: Laravels Regel verlangt das Feld immer. Hier ist es
     * freiwillig - fehlt es, wird nicht verglichen. Uebernommen, damit aeltere
     * App-Fassungen, die es nicht senden, weiter funktionieren.
     */
    private function confirmationRule(Request $request): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail) use ($request): void {
            if ($request->has('password_confirmation')
                && $request->input('password_confirmation') !== $value) {
                $fail('Die Passwoerter stimmen nicht ueberein.');
            }
        };
    }
}
