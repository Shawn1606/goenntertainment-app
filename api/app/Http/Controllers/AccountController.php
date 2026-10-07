<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Mail\AccountSecurityNotice;
use App\Models\TwoFactorChallenge;
use App\Models\User;
use App\Rules\ValidEmail;
use App\Support\NodeInternal;
use App\Support\PasswordPolicy;
use App\Support\Passwords;
use App\Support\Sessions;
use App\Support\StepUp;
use App\Support\TwoFactor;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;

/**
 * Das eigene Konto: Passwort aendern und Konto loeschen.
 */
class AccountController extends Controller
{
    /** Das Wort, das Konten ohne Passwort zum Loeschen tippen (only Laravel checks it). */
    private const CONFIRM_WORDS = ['LÖSCHEN', 'LOESCHEN'];

    private const MSG_LAST_ADMIN = 'Du bist der letzte Admin – ernenne erst jemand anderen, bevor du dein Konto löschst.';

    private const MSG_SAME_EMAIL = 'Das ist bereits deine E-Mail-Adresse.';

    private const MSG_EMAIL_TAKEN = 'Diese E-Mail-Adresse ist bereits registriert.';

    private const MSG_NOTICE_FAILED = 'Wir konnten gerade keinen Hinweis an deine bisherige Adresse schicken – deine E-Mail-Adresse bleibt unverändert. Probier es gleich noch mal.';

    /**
     * PUT /api/user/password {current_password, password}
     *
     * ## Konten ohne Passwort
     *
     * (Accounts without a password were created by Google sign-in, which has
     * been removed; existing ones keep this path.)
     * Die Google-Anmeldung legte Konten OHNE Passwort an - die Spalte bleibt
     * NULL, und NULL ist dort genau das: „dieses Konto hat keins" (siehe auch
     * Passwords::check, das dafuer immer false liefert). Fuer diese Konten gibt
     * es kein aktuelles Passwort, das man abfragen koennte; sie duerfen eines
     * SETZEN, allein mit ihrer Anmeldung. Das ist nicht weniger sicher als
     * bisher: Wer den Token hat, konnte schon jetzt alles am Konto aendern, und
     * die Alternative - „Passwort vergessen" per Mail - gibt es erst, wenn der
     * Mail-Versand steht.
     *
     * Entscheidend ist, dass das NUR bei NULL/leer gilt. Ein Konto mit Passwort,
     * das zusaetzlich an Google haengt, muss sein Passwort kennen - sonst waere
     * ein gestohlener Token genug, um sich dauerhaft ein eigenes Passwort
     * einzurichten.
     *
     * ## Andere Geraete werden abgemeldet
     *
     * Alle Tokens ausser dem, mit dem gerade geaendert wird. Das ist der Sinn
     * der Sache: Wer sein Passwort aendert, weil er fuerchtet, dass es jemand
     * kennt, will genau diesen Jemand loswerden. (A password reset signs out every device,
     * PasswordController; both go through App\Support\Sessions.)
     */
    public function updatePassword(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $hasPassword = is_string($user->password) && $user->password !== '';

        $rules = [];
        $messages = [];

        // Zuerst das aktuelle Passwort: Ist es falsch, ist das die Meldung -
        // nicht ein Hinweis zur Staerke des neuen, das ohnehin nicht gesetzt wird.
        if ($hasPassword) {
            $rules['current_password'] = ['bail', 'required', $this->currentPasswordRule($user)];
            $messages['current_password.required'] = 'Bitte gib dein aktuelles Passwort ein.';
        }

        $rules['password'] = [
            'bail',
            'required',
            PasswordPolicy::rule($user->username, $user->email),
            $this->confirmationRule($request),
        ];
        $messages['password.required'] = PasswordPolicy::MSG_BASIC;

        Validator::make($request->all(), $rules, $messages)->validate();

        /**
         * `Hash::make` ausdruecklich, nicht die Zuweisung an den `hashed`-Cast:
         * Der Cast uebernimmt einen Wert, der schon WIE ein bcrypt-Hash aussieht,
         * unveraendert. Wer als „neues Passwort" einen Hash schickt, haette
         * sonst ein Passwort, das die Regel oben nie gesehen hat.
         */
        $user->password = Hash::make((string) $request->input('password'));
        $user->remember_token = null;
        $user->save();

        Sessions::revokeOthers($user);

        // Ein offener „Passwort vergessen"-Link soll das neue nicht gleich wieder ersetzen koennen.
        DB::table('password_reset_tokens')->where('email', $user->email)->delete();

        return response()->json(['message' => 'Passwort geändert.']);
    }

    /**
     * PUT /api/user/email {email, current_password}, plus {code} when two-factor sign-in is on
     *
     * The only way to change the address (F-04): it is where password-reset mails and e-mail
     * codes go, so whoever controls it can take the account over. A session alone is therefore
     * not enough - the current password is, and with two-factor sign-in the current code too
     * (for the e-mail method mailed to the CURRENT address, POST /user/two-factor/code).
     *
     * Order of the checks: the new address (format, unchanged, reserved), the password, the
     * address being free, the code last - a code is used up when it is checked (a recovery code
     * for good), so it must not be lost to a typo or a taken address.
     *
     * Then, in one transaction: the new address (not verified), every other session signed out,
     * open reset links and e-mail codes of the old address dropped, and a notice to the OLD
     * address. If that notice cannot be sent, nothing changes (503): it is the owner's only
     * signal that the recovery channel moved.
     */
    public function updateEmail(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $old = (string) $user->email;

        Validator::make($request->all(), [
            'email' => [
                'bail',
                'required',
                new ValidEmail,
                static function (string $attribute, mixed $value, Closure $fail) use ($old): void {
                    if ($value === $old) {
                        $fail(self::MSG_SAME_EMAIL);
                    }
                },
                AuthController::notReservedEmail(),
            ],
        ], [
            'email.required' => ValidEmail::MESSAGE,
        ])->validate();

        $new = (string) $request->input('email');

        StepUp::assertPassword($user, $request->input('current_password'), 'current_password');

        if (User::where('email', $new)->whereKeyNot($user->getKey())->exists()) {
            throw ValidationException::withMessages(['email' => [self::MSG_EMAIL_TAKEN]]);
        }

        if (TwoFactor::isEnabled($user)) {
            TwoFactor::assertCode($user, $request->input('code'));
        }

        try {
            DB::transaction(function () use ($user, $old, $new) {
                $locked = User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();
                $locked->forceFill(['email' => $new, 'email_verified_at' => null])->save();
                $user->forceFill(['email' => $new, 'email_verified_at' => null])->syncOriginal();

                Sessions::revokeOthers($user);
                DB::table('password_reset_tokens')->where('email', $old)->delete();
                TwoFactorChallenge::where('user_id', $user->getKey())
                    ->whereIn('purpose', [TwoFactor::PURPOSE_SETUP, TwoFactor::PURPOSE_CONFIRM])
                    ->delete();

                Mail::to($old)->send(new AccountSecurityNotice(AccountSecurityNotice::EMAIL_CHANGED, TwoFactor::maskEmail($new)));
            });
        } catch (TransportExceptionInterface $e) {
            // Rolled back. The user id and the exception class only: no address, no message.
            Log::error('[account] e-mail change notice not sent; nothing changed', [
                'user_id' => $user->getKey(),
                'exception' => $e::class,
            ]);
            $user->refresh();

            return response()->json(['message' => self::MSG_NOTICE_FAILED], 503);
        } catch (UniqueConstraintViolationException) {
            // Someone registered the address between the check and the update.
            $user->refresh();

            throw ValidationException::withMessages(['email' => [self::MSG_EMAIL_TAKEN]]);
        }

        $user->refresh();

        return response()->json([
            'user' => (new UserResource($user))->withInterests()->toArray($request),
            'profile_complete' => $user->profileComplete(),
        ]);
    }

    /**
     * DELETE /api/me {password} | {confirm: "LÖSCHEN"}, bei aktiver 2FA dazu {code}
     *
     * ## Wer hier was tut
     *
     * PRUEFEN tut Laravel: Passwort (oder das Bestaetigungswort), „letzter
     * Admin" und - nur hier moeglich, weil das TOTP-Secret mit APP_KEY
     * verschluesselt ist - den Zwei-Faktor-Code. LOESCHEN tut Node
     * (server/src/account-deletion.js): Dort liegen die Datei-Pfade, und
     * derselbe Ablauf dient dem Admin-Panel. Zwei Implementierungen davon liefen
     * frueher oder spaeter auseinander - und eine vergessene Upload-Art hiesse
     * Bilder, die nach der Loeschung oeffentlich weiterleben.
     *
     * Die Reihenfolge der Pruefungen ist Absicht: erst das Passwort, dann „letzter
     * Admin", zuletzt der Code. Ein Code wird beim Pruefen VERBRAUCHT (ein
     * Wiederherstellungscode fuer immer) - er soll nicht an einem Tippfehler im
     * Passwort oder an einer 409 verloren gehen.
     *
     * Danach eine Freigabe (TwoFactor::createDeletionGrant) und der Aufruf von
     * Node's internal route DELETE /internal/accounts/{id} with the shared secret
     * (App\Support\NodeInternal), not the public fallback: /api/me is a path
     * Laravel owns, and the fallback never forwards those. Without a Node address
     * or secret the answer is a 503 and nothing is deleted.
     */
    public function destroy(Request $request): Response
    {
        /** @var User $user */
        $user = $request->user();

        if (is_string($user->password) && $user->password !== '') {
            $password = $request->input('password');

            if (! is_string($password) || $password === '') {
                throw ValidationException::withMessages(['password' => ['Bitte gib dein Passwort ein.']]);
            }
            if (! Passwords::check($password, $user->password)) {
                throw ValidationException::withMessages(['password' => [TwoFactor::MSG_PASSWORD_WRONG]]);
            }
        } elseif (! $this->confirmWordOk($request->input('confirm'))) {
            throw ValidationException::withMessages(['confirm' => ['Bitte tippe LÖSCHEN ein, um dein Konto zu löschen.']]);
        }

        if ($user->is_admin && ! User::where('is_admin', true)->whereKeyNot($user->getKey())->exists()) {
            return response()->json(['message' => self::MSG_LAST_ADMIN], 409);
        }

        if (TwoFactor::isEnabled($user)) {
            TwoFactor::assertCode($user, $request->input('code'));
        }

        return NodeInternal::deleteAccount($user, TwoFactor::createDeletionGrant($user));
    }

    /** Stimmt das aktuelle Passwort? Als Regel, damit die Meldung am Feld steht. */
    private function currentPasswordRule(User $user): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail) use ($user): void {
            if (! is_string($value) || ! Passwords::check($value, $user->password)) {
                $fail('Das aktuelle Passwort stimmt nicht.');
            }
        };
    }

    /** Bestaetigung nur pruefen, wenn sie mitkommt - wie beim Zuruecksetzen (PasswordController). */
    private function confirmationRule(Request $request): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail) use ($request): void {
            if ($request->has('password_confirmation')
                && $request->input('password_confirmation') !== $value) {
                $fail('Die Passwörter stimmen nicht überein.');
            }
        };
    }

    /** „LÖSCHEN" - gross/klein egal, auch ohne Umlaut (Tastaturen ohne Ö). */
    private function confirmWordOk(mixed $value): bool
    {
        if (! is_string($value)) {
            return false;
        }

        $word = mb_strtoupper(trim(\Normalizer::normalize($value, \Normalizer::FORM_C) ?: $value), 'UTF-8');

        return in_array($word, self::CONFIRM_WORDS, true);
    }
}
