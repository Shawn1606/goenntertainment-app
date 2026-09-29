<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\PasswordPolicy;
use App\Support\Passwords;
use App\Support\TwoFactor;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * Das eigene Konto: Passwort aendern und Konto loeschen.
 */
class AccountController extends Controller
{
    /** Das Wort, das Konten ohne Passwort zum Loeschen tippen (wie in server/src/routes/account.js). */
    private const CONFIRM_WORDS = ['LÖSCHEN', 'LOESCHEN'];

    private const MSG_LAST_ADMIN = 'Du bist der letzte Admin – ernenne erst jemand anderen, bevor du dein Konto löschst.';

    /**
     * PUT /api/user/password {current_password, password}
     *
     * ## Konten ohne Passwort
     *
     * GoogleController legt neue Konten OHNE Passwort an - die Spalte bleibt
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
     * kennt, will genau diesen Jemand loswerden. Anders als beim Zuruecksetzen
     * (PasswordController, dort bleibt es wie im alten Backend) - hier gibt es
     * kein Verhalten, auf das sich jemand verlaesst.
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

        $current = $user->currentAccessToken();
        $currentId = $current instanceof PersonalAccessToken ? $current->getKey() : null;

        $user->tokens()
            ->when($currentId !== null, fn ($q) => $q->whereKeyNot($currentId))
            ->delete();

        // Ein offener „Passwort vergessen"-Link soll das neue nicht gleich wieder ersetzen koennen.
        DB::table('password_reset_tokens')->where('email', $user->email)->delete();

        return response()->json(['message' => 'Passwort geändert.']);
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
     * Danach eine Freigabe (TwoFactor::createDeletionGrant) und Weitergabe an
     * Node ueber denselben Weg wie jede noch nicht portierte Route. Ist der
     * Rueckfall abgeschaltet (NODE_FALLBACK_URL leer), muss das Loeschen vorher
     * hierher umgezogen sein - sonst antwortet dieser Endpunkt mit 404.
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

        // Selbst gesetzt, nie aus der Anfrage uebernommen: Eine mitgeschickte
        // Kopfzeile gleichen Namens wird hier ueberschrieben.
        $request->headers->set('X-Account-Deletion-Grant', TwoFactor::createDeletionGrant($user));

        return app(NodeFallbackController::class)($request, 'me');
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
