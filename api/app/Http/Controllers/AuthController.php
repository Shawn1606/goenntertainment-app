<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\User;
use App\Rules\NoBlockedTerms;
use App\Rules\ValidEmail;
use App\Support\AccountTypes;
use App\Support\EmailAddress;
use App\Support\Passwords;
use App\Support\PasswordPolicy;
use App\Support\ReservedAccounts;
use App\Support\Sessions;
use App\Support\TwoFactor;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Registrieren, Anmelden, Abmelden, eigenes Konto lesen und aendern.
 *
 * ## Warum die Pruefungen hier von Hand stehen
 *
 * Laravel hat fuer E-Mail-Adressen, Eindeutigkeit und Laengen fertige Regeln, und
 * normalerweise waeren sie die richtige Wahl. Hier nicht: Diese API ist seit
 * Monaten im Einsatz, und die App zeigt die Meldungen des Servers WOERTLICH an
 * (siehe src/lib/api.ts). Laravels `email`-Regel ist ausserdem strenger als die
 * bisherige Pruefung - Adressen, die gestern durchgingen, waeren ploetzlich
 * ungueltig, und zwar nur fuer die, die sie benutzen.
 *
 * Darum: dieselben Muster, dieselben Texte, dieselbe Reihenfolge wie zuvor. Die
 * Reihenfolge ist kein Zierrat - `message` ist die ERSTE Meldung, und die App
 * zeigt genau die an.
 *
 * `bail` an jedem Feld sorgt fuer hoechstens eine Meldung pro Feld. Ohne das
 * sammelte Laravel alle Verstoesse eines Feldes ein, und aus einem zu kurzen
 * Benutzernamen wuerden zwei Meldungen - eine mehr als die App erwartet.
 */
class AuthController extends Controller
{
    /** Benutzername: Buchstaben, Zahlen, Unterstrich, Bindestrich. */
    private const USERNAME_PATTERN = '/^[\w-]+$/';

    private const MSG_EMAIL = ValidEmail::MESSAGE;

    private const MSG_USERNAME_FORMAT = 'Der Benutzername ist ungueltig (3-30 Zeichen, nur Buchstaben/Zahlen/-_).';

    private const MSG_PASSWORD = 'Das Passwort muss mindestens 8 Zeichen mit Buchstaben und Zahlen haben.';

    private const MSG_EMAIL_NEEDS_STEP_UP = 'Die E-Mail-Adresse lässt sich nur mit deinem Passwort ändern – nutze „E-Mail-Adresse ändern" in den Einstellungen.';

    /** POST /api/register */
    public function register(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            /**
             * Gesperrte Begriffe (shared/blocked-terms.json) als LETZTE Regel: Ein
             * zu kurzer oder falsch geschriebener Benutzername bekommt zuerst die
             * Format-Meldung, und dank `bail` steht nie beides da. Die Meldung ist
             * dieselbe, die die App vorab am Feld zeigt.
             */
            'name' => ['bail', 'required', 'string', new NoBlockedTerms('name')],
            // Names and addresses the system creates for itself are refused (F-05,
            // shared/reserved-accounts.json), before anyone can take them ahead of the seed.
            'username' => ['bail', 'required', 'string', 'min:3', 'max:30', 'regex:'.self::USERNAME_PATTERN, self::notReservedUsername(null), new NoBlockedTerms('username')],
            // The former pattern, in linear time and capped at 254 characters (App\Support\EmailAddress).
            'email' => ['bail', 'required', new ValidEmail, self::notReservedEmail()],
            'password' => ['bail', 'required', $this->passwordRule()],
            /**
             * `required` steht hier nicht zur Zierde: Ohne es ueberspringt Laravel
             * eine eigene Regel, wenn das Feld gar nicht mitgeschickt wurde - und
             * eine Registrierung ohne Kontostufe waere stillschweigend in Ordnung.
             * Bisher war ein fehlender Wert genau so falsch wie ein erfundener,
             * und beide bekommen dieselbe Meldung.
             */
            'account_type' => ['bail', 'required', $this->registrableAccountTypeRule()],
        ], [
            'name.required' => 'Der Name ist erforderlich.',
            'name.string' => 'Der Name ist erforderlich.',
            'username.required' => 'Der Benutzername ist erforderlich.',
            'username.string' => 'Der Benutzername ist erforderlich.',
            'username.min' => self::MSG_USERNAME_FORMAT,
            'username.max' => self::MSG_USERNAME_FORMAT,
            'username.regex' => self::MSG_USERNAME_FORMAT,
            'email.required' => self::MSG_EMAIL,
            'password.required' => self::MSG_PASSWORD,
            'account_type.required' => 'Ungueltiger Kontotyp.',
        ]);

        /**
         * Eindeutigkeit und Kategorien erst danach - und nur, wenn das Feld
         * bislang fehlerfrei ist.
         *
         * Das ist uebernommen, nicht nachlaessig: Bei einem drei Zeichen kurzen
         * Benutzernamen steht schon eine Meldung, und ein zweites „ist bereits
         * vergeben" daneben hilft niemandem - erst recht nicht, wenn der Name
         * genau deshalb frei ist, weil er zu kurz ist.
         */
        $validator->after(function ($v) use ($request) {
            $username = $request->input('username');
            if (! $v->errors()->has('username') && is_string($username) && $username !== '') {
                if (User::where('username', $username)->exists()) {
                    $v->errors()->add('username', 'Dieser Benutzername ist bereits vergeben.');
                }
            }

            $email = $request->input('email');
            if (! $v->errors()->has('email') && EmailAddress::isValid($email)) {
                if (User::where('email', $email)->exists()) {
                    $v->errors()->add('email', 'Diese E-Mail-Adresse ist bereits registriert.');
                }
            }

            if ($this->missingInterests($this->interestIds($request->input('interests'))) !== []) {
                $v->errors()->add('interests', 'Mindestens ein Interesse existiert nicht.');
            }
        });

        $validator->validate();

        $user = new User;
        $user->name = $request->input('name');
        $user->username = $request->input('username');
        $user->email = $request->input('email');
        /**
         * Ausdruecklich hashen, nicht dem `hashed`-Cast ueberlassen: Der Cast
         * speichert einen Wert, der schon wie ein bcrypt-Hash AUSSIEHT, unveraendert.
         * Wer als Passwort einen fertigen Hash schickt, haette sonst ein Konto, dessen
         * Passwort niemand kennt - oder eines, fuer das er den Klartext kennt, ohne
         * dass die Passwortregel ihn je gesehen hat.
         */
        $user->password = Hash::make((string) $request->input('password'));
        $user->account_type = AccountTypes::normalize($request->input('account_type'));

        /**
         * Stand der Nutzungsbedingungen, dem zugestimmt wurde.
         *
         * Kommt aus der App (`LEGAL_VERSION` in src/domain/legal.ts) und wird hier
         * NICHT geprueft: Der Server kennt den Text nicht und soll ihn nicht kennen -
         * er haelt fest, WAS bestaetigt wurde, damit sich nach einer Aenderung
         * erkennen laesst, wer noch dem alten Stand zugestimmt hat. Fehlt die
         * Angabe (aeltere App-Fassung), bleibt die Spalte NULL, und die App fragt
         * beim naechsten Start nach.
         */
        $terms = $request->input('terms_version');
        $termsVersion = (is_string($terms) && trim($terms) !== '')
            ? mb_substr(trim($terms), 0, 20)
            : null;

        $user->terms_version = $termsVersion;
        $user->terms_accepted_at = $termsVersion !== null ? now() : null;
        $user->save();

        $interests = $this->interestIds($request->input('interests'));
        if ($interests !== []) {
            $user->interests()->attach($interests);
        }

        return $this->tokenResponse($request, $user, 201);
    }

    /** POST /api/login */
    public function login(Request $request): JsonResponse
    {
        Validator::make($request->all(), [
            'email' => ['bail', 'required', new ValidEmail],
            'password' => ['required'],
        ], [
            'email.required' => self::MSG_EMAIL,
            'password.required' => 'Das Passwort ist erforderlich.',
        ])->validate();

        $user = User::where('email', $request->input('email'))->first();

        if ($user === null || ! Passwords::check((string) $request->input('password'), $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['Diese Zugangsdaten passen nicht zu unseren Aufzeichnungen.'],
            ]);
        }

        // Gesperrte Konten kommen nicht rein - mit Details (Grund/Dauer) fuer das Popup.
        if ($user->isBanned()) {
            return response()->json([
                'message' => 'Dein Konto ist gesperrt.',
                'ban' => $user->banInfo(),
            ], 403);
        }

        /**
         * Zwei-Faktor-Anmeldung an: KEIN Token, sondern ein Vorgang, der auf den
         * Code wartet (App\Support\TwoFactor). Den Token gibt es erst bei
         * POST /login/two-factor. Die Sperre ist schon geprueft - wer gesperrt
         * ist, bekommt gar nicht erst einen Code gemailt.
         */
        if (TwoFactor::isEnabled($user)) {
            return TwoFactor::startLogin($user);
        }

        return $this->tokenResponse($request, $user);
    }

    /** POST /api/logout (geschuetzt) */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['message' => 'Abgemeldet.']);
    }

    /** GET /api/user (geschuetzt) */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'user' => (new UserResource($user))->withInterests()->toArray($request),
            'profile_complete' => $user->profileComplete(),
        ]);
    }

    /**
     * PATCH /api/user (geschuetzt) - Profil bearbeiten.
     *
     * Teil-Update: nur mitgeschickte Felder werden geaendert.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();

        $rules = [];
        $messages = [];

        /**
         * Gesperrte Begriffe nur bei einem NEUEN Wert pruefen.
         *
         * Die App schickt beim Speichern das ganze Profil mit. Traefe die Liste
         * einen Namen, der schon vor ihr bestand, koennte die Person sonst nicht
         * einmal mehr ihre Interessen aendern - ohne zu verstehen, warum ihr Name
         * ploetzlich stoert. Solche Altfaelle raeumt ein Admin auf (Umbenennen im
         * Admin-Bereich); neu vergeben wird ein gesperrter Wert so oder so nicht.
         */
        $blockedTermsRule = static fn (string $mode, mixed $current): Closure => static function (string $attribute, mixed $value, Closure $fail) use ($mode, $current): void {
            if ($value !== $current) {
                (new NoBlockedTerms($mode))->validate($attribute, $value, $fail);
            }
        };

        if ($request->has('name')) {
            $rules['name'] = ['bail', 'required', 'string', $blockedTermsRule('name', $user->name)];
            $messages['name.required'] = 'Der Name ist erforderlich.';
            $messages['name.string'] = 'Der Name ist erforderlich.';
        }

        if ($request->has('username')) {
            $rules['username'] = ['bail', 'required', 'string', 'min:3', 'max:30', 'regex:'.self::USERNAME_PATTERN, self::notReservedUsername($user->username), $blockedTermsRule('username', $user->username)];
            $messages['username.required'] = 'Der Benutzername ist erforderlich.';
            $messages['username.string'] = 'Der Benutzername ist erforderlich.';
            $messages['username.min'] = self::MSG_USERNAME_FORMAT;
            $messages['username.max'] = self::MSG_USERNAME_FORMAT;
            $messages['username.regex'] = self::MSG_USERNAME_FORMAT;
        }

        /**
         * The e-mail address is no longer changed here (F-04): it takes the current password, and
         * the code with two-factor sign-in, at PUT /user/email (AccountController::updateEmail).
         * Sending the unchanged address stays valid: profile forms send the whole profile.
         */
        if ($request->has('email')) {
            $rules['email'] = ['bail', static function (string $attribute, mixed $value, Closure $fail) use ($user): void {
                if ($value !== $user->email) {
                    $fail(self::MSG_EMAIL_NEEDS_STEP_UP);
                }
            }];
        }

        /**
         * Kontostufe umstellen - Admins vorbehalten.
         *
         * Die Stufe schaltet Rechte frei (Events erstellen, Business-Bereich), die
         * sich niemand im Selbstbedienungsverfahren geben soll. Die Pruefung sitzt
         * am FELD statt am ganzen Endpunkt - Name/E-Mail/Interessen bleiben fuer
         * alle offen.
         *
         * Und sie steht VOR der Auswertung der uebrigen Felder: Wer die Stufe ohne
         * Recht aendern will, bekommt 403 - auch dann, wenn zugleich der Name leer
         * waere. Ein 422 ueber den Namen wuerde verschweigen, dass der eigentliche
         * Wunsch ohnehin abgelehnt ist. Genau diese Reihenfolge hatte das vorige
         * Backend.
         */
        if ($request->has('account_type')) {
            if (! $user->is_admin) {
                return response()->json(['message' => 'Nur Admins duerfen den Kontotyp aendern.'], 403);
            }

            // `required` aus demselben Grund wie bei der Registrierung: sonst
            // rutscht `account_type: null` ungepruefet durch.
            $rules['account_type'] = ['bail', 'required', $this->assignableAccountTypeRule()];
            $messages['account_type.required'] = 'Ungueltiger Kontotyp.';
        }

        $interests = null;
        $rawInterests = $request->input('interests');
        $interestsGiven = $request->has('interests');

        $validator = Validator::make($request->all(), $rules, $messages);

        $validator->after(function ($v) use ($request, $user, $interestsGiven, $rawInterests, &$interests) {
            $username = $request->input('username');
            if (! $v->errors()->has('username') && is_string($username) && $username !== '' && $username !== $user->username) {
                if (User::where('username', $username)->where('id', '<>', $user->id)->exists()) {
                    $v->errors()->add('username', 'Dieser Benutzername ist bereits vergeben.');
                }
            }

            if ($interestsGiven) {
                if (! is_array($rawInterests)) {
                    $v->errors()->add('interests', 'Interessen muessen als Liste uebergeben werden.');
                } else {
                    $interests = $this->interestIds($rawInterests);
                    if ($this->missingInterests($interests) !== []) {
                        $v->errors()->add('interests', 'Mindestens ein Interesse existiert nicht.');
                    }
                }
            }
        });

        $validator->validate();

        $touched = false;

        if ($request->has('name')) {
            $user->name = trim((string) $request->input('name'));
            $touched = true;
        }
        if ($request->has('username')) {
            $user->username = $request->input('username');
            $touched = true;
        }
        if ($request->has('email')) {
            // Unchanged (checked above); counts as a sent field, as before.
            $touched = true;
        }
        if ($request->has('account_type')) {
            $user->account_type = AccountTypes::normalize($request->input('account_type'));
            $touched = true;
        }

        /**
         * Gespeichert wird, sobald ein Feld MITGESCHICKT wurde - nicht erst, wenn
         * sich ein Wert wirklich aendert.
         *
         * Der Unterschied klingt nach Kleinkram, ist aber sichtbar: `updated_at`
         * steht in der Antwort. Das vorige Backend schrieb bei jedem PATCH mit
         * Feldern `updated_at = NOW()`, auch wenn der Name derselbe blieb. Mit
         * Eloquents Vorgabe („nur speichern, wenn schmutzig") waere ein Speichern
         * ohne Aenderung ein stiller Nichtstuer - und die App bekaeme einen
         * anderen Zeitstempel als bisher.
         */
        if ($touched) {
            $user->updated_at = now();
            $user->save();
        }

        // Kategorien komplett neu setzen (alte weg, mitgeschickte rein).
        if ($interests !== null) {
            $user->interests()->sync($interests);
        }

        $user->refresh();

        return response()->json([
            'user' => (new UserResource($user))->withInterests()->toArray($request),
            'profile_complete' => $user->profileComplete(),
        ]);
    }

    /**
     * Antwort mit frischem Token - das Format, das die App nach jeder Anmeldung
     * erwartet.
     */
    private function tokenResponse(Request $request, User $user, int $status = 200): JsonResponse
    {
        // With an expiry date (App\Support\Sessions, the one place that issues tokens).
        $token = Sessions::issue($user, $request->input('device_name'));

        return response()->json([
            'user' => (new UserResource($user))->withInterests()->toArray($request),
            'token' => $token,
            'profile_complete' => $user->profileComplete(),
        ], $status);
    }

    /**
     * Passwortregel der Registrierung - App\Support\PasswordPolicy: die alte
     * Grundregel (Text unveraendert), dazu haeufige Passwoerter und
     * Benutzername/E-Mail im Passwort.
     *
     * Benutzername und E-Mail kommen aus DIESER Anfrage - das Konto gibt es ja
     * noch nicht. Gelesen ueber `request()`, damit die Regel-Liste in
     * register() unveraendert `$this->passwordRule()` aufrufen kann.
     */
    private function passwordRule(): Closure
    {
        $username = request()->input('username');
        $email = request()->input('email');

        return PasswordPolicy::rule(
            is_string($username) ? $username : null,
            is_string($email) ? $email : null,
        );
    }

    /**
     * Kontostufe bei der Registrierung.
     *
     * Unbekannte Werte werden abgewiesen statt stillschweigend auf Standard
     * gedreht: Ein Tippfehler im Client soll auffallen, nicht durchrutschen. Und
     * eine Stufe, die es GIBT, aber nicht zur Selbstbedienung, bekommt eine eigene
     * Meldung - sonst suchte jemand den Fehler im Wort, obwohl das Wort richtig ist.
     */
    private function registrableAccountTypeRule(): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail): void {
            if (in_array($value, AccountTypes::registrable(), true)) {
                return;
            }

            $fail(in_array($value, AccountTypes::ALL, true)
                ? 'Diese Stufe gibt es erst nach Freischaltung – frag sie in der App an.'
                : 'Ungueltiger Kontotyp.');
        };
    }

    /**
     * A username the system reserves for itself (shared/reserved-accounts.json) is refused, unless
     * it is the account's current one (the admin may keep sending its own name with a profile).
     */
    public static function notReservedUsername(?string $current): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail) use ($current): void {
            $unchanged = is_string($value) && $current !== null
                && mb_strtolower($value, 'UTF-8') === mb_strtolower($current, 'UTF-8');
            if (! $unchanged && ReservedAccounts::default()->isReservedUsername($value)) {
                $fail(ReservedAccounts::MSG_USERNAME);
            }
        };
    }

    /** An address in a domain the system reserves for its own accounts is refused. */
    public static function notReservedEmail(): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail): void {
            if (ReservedAccounts::default()->isReservedEmail($value)) {
                $fail(ReservedAccounts::MSG_EMAIL);
            }
        };
    }

    /** Was ein Admin per PATCH setzen darf. */
    private function assignableAccountTypeRule(): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail): void {
            if (! in_array($value, AccountTypes::assignable(), true)) {
                $fail('Ungueltiger Kontotyp.');
            }
        };
    }

    /** Kategorie-IDs aus der Anfrage - alles Unbrauchbare fliegt raus. */
    private function interestIds(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }

        $ids = [];
        foreach ($raw as $value) {
            if (is_numeric($value)) {
                $ids[] = (int) $value;
            }
        }

        return array_values(array_unique($ids));
    }

    /** Welche der IDs es nicht gibt? */
    private function missingInterests(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $found = \App\Models\Interest::whereIn('id', $ids)->pluck('id')->all();

        return array_values(array_diff($ids, $found));
    }
}
