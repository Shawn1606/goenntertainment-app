<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Rules\ValidEmail;
use App\Support\Passwords;
use App\Support\PasswordPolicy;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Passwort vergessen und zuruecksetzen.
 *
 * ## Warum nicht Laravels Password-Broker
 *
 * Laravel bringt das fertig mit - aber mit eigenen Meldungen, eigenen Status-Namen
 * ('passwords.sent') und einem Mail-Versand, den es hier noch nicht gibt. Die App
 * liest `status` und zeigt `message` woertlich an. Also dieselbe Logik wie zuvor,
 * mit denselben Texten; der Broker kann kommen, wenn der Mail-Versand kommt.
 *
 * Der Token wird GEHASHT gespeichert - er ist ein Passwort auf Zeit. In der
 * Tabelle steht deshalb nie der Wert, den die Nutzer:in bekommt.
 */
class PasswordController extends Controller
{
    /** Wie Laravel: Reset-Links laufen nach 60 Minuten ab. */
    private const EXPIRE_MINUTES = 60;

    private const MSG_EMAIL = ValidEmail::MESSAGE;

    /**
     * POST /api/forgot-password
     *
     * Antwortet IMMER neutral - so verraet die API nicht, ob eine E-Mail
     * registriert ist. Das ist der ganze Zweck der Gleichbehandlung: Wer hier
     * Adressen durchprobiert, lernt nichts.
     */
    public function forgot(Request $request): JsonResponse
    {
        Validator::make($request->all(), [
            'email' => ['bail', 'required', new ValidEmail],
        ], [
            'email.required' => self::MSG_EMAIL,
        ])->validate();

        $email = (string) $request->input('email');

        if (User::where('email', $email)->exists()) {
            $token = $this->makeResetToken();

            DB::statement(
                'INSERT INTO password_reset_tokens (email, token, created_at)
                   VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE token = VALUES(token), created_at = NOW()',
                [$email, Hash::make($token)],
            );

            // TODO: deliver the reset by mail. Until then the token goes nowhere: it is never
            // written to a log, because whoever can read the log could take over the account.
        }

        return response()->json([
            'status' => 'sent',
            'message' => 'Falls ein Konto existiert, ist eine E-Mail zum Zuruecksetzen unterwegs.',
        ]);
    }

    /**
     * POST /api/reset-password
     *
     * Setzt mit gueltigem Token ein neues Passwort und verbraucht den Token
     * (Einmal-Nutzung).
     */
    public function reset(Request $request): JsonResponse
    {
        Validator::make($request->all(), [
            'token' => ['required'],
            'email' => ['bail', 'required', new ValidEmail],
            'password' => ['bail', 'required', $this->passwordRule($request), $this->confirmationRule($request)],
        ], [
            'token.required' => 'Der Token fehlt.',
            'email.required' => self::MSG_EMAIL,
            'password.required' => 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.',
        ])->validate();

        $email = (string) $request->input('email');

        $row = DB::selectOne(
            'SELECT email, token, created_at FROM password_reset_tokens WHERE email = ?',
            [$email],
        );

        // Passwords::check statt Hash::check: Auch die Reset-Tokens des vorigen
        // Backends sind mit bcryptjs gehasht und tragen dessen Praefix.
        if ($row === null || ! Passwords::check((string) $request->input('token'), $row->token)) {
            throw $this->invalidLink();
        }

        $ageSeconds = now()->diffInSeconds(\Carbon\CarbonImmutable::parse($row->created_at), absolute: true);

        if ($ageSeconds > self::EXPIRE_MINUTES * 60) {
            DB::delete('DELETE FROM password_reset_tokens WHERE email = ?', [$email]);

            throw $this->invalidLink();
        }

        /**
         * Benutzername im Passwort? Erst JETZT, mit gueltigem Token.
         *
         * In der Validierung oben waere die Meldung ein Orakel: Wer zu einer
         * fremden Adresse Passwoerter durchprobiert, erfuehre aus „darf deinen
         * Benutzernamen nicht enthalten", dass es das Konto gibt - und Stueck fuer
         * Stueck, wie es heisst. Genau das soll die neutrale Antwort von
         * forgot() verhindern. Grundregel, Liste und E-Mail-Teil haengen an
         * nichts Geheimem und stehen deshalb schon oben.
         */
        $username = User::where('email', $email)->value('username');
        if (PasswordPolicy::problem((string) $request->input('password'), is_string($username) ? $username : null) !== null) {
            throw ValidationException::withMessages(['password' => [PasswordPolicy::MSG_PERSONAL]]);
        }

        /**
         * Neues Passwort setzen und die Reset-Zeile verbrauchen.
         *
         * Bestehende Zugriffs-Tokens bleiben ABSICHTLICH gueltig - genau so hielt
         * es das vorige Backend. Angemeldete Geraete werden also nicht abgemeldet.
         */
        User::where('email', $email)->update([
            'password' => Hash::make((string) $request->input('password')),
            'remember_token' => null,
            'updated_at' => now(),
        ]);

        DB::delete('DELETE FROM password_reset_tokens WHERE email = ?', [$email]);

        return response()->json([
            'status' => 'reset',
            'message' => 'Dein Passwort wurde zurueckgesetzt.',
        ]);
    }

    /**
     * Gleiche neutrale Meldung fuer „Token falsch" UND „Token abgelaufen".
     *
     * Der Unterschied waere eine Auskunft, die nur jemandem hilft, der fremde
     * Tokens durchprobiert.
     */
    private function invalidLink(): ValidationException
    {
        return ValidationException::withMessages([
            'email' => ['Dieser Link zum Zuruecksetzen ist ungueltig.'],
        ]);
    }

    /** Zufaelliger 64-Zeichen-Token (Klartext an die Nutzer:in, gehasht in die DB). */
    private function makeResetToken(): string
    {
        $raw = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');

        return substr($raw, 0, 64);
    }

    /**
     * Dieselbe Regel wie bei der Registrierung (App\Support\PasswordPolicy) -
     * hier zunaechst nur mit dem E-Mail-Teil; der Benutzername kommt erst nach
     * der Token-Pruefung dazu (Begruendung in reset()).
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
