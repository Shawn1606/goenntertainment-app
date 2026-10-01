<?php

namespace App\Support;

use App\Mail\TwoFactorCode;
use App\Models\TwoFactorChallenge;
use App\Models\User;
use Closure;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * Zwei-Faktor-Anmeldung: Codes per E-Mail ODER aus einer Authenticator-App.
 *
 * ## Das Grundgeruest
 *
 * `users.two_factor_method` ist der einzige Schalter (NULL | 'email' | 'totp').
 * Alles, was auf einen Code wartet, ist ein „Vorgang" in two_factor_challenges -
 * die Anmeldung nach dem Passwort ('login'), das Einschalten per E-Mail
 * ('setup'), das Bestaetigen heikler Aktionen per E-Mail ('confirm').
 *
 * Die App haelt fuer einen Vorgang nur einen zufaelligen Token in der Hand, in
 * der Tabelle steht sein sha256. Er ist das, was „Passwort war richtig" von
 * einem Aufruf zum naechsten traegt - OHNE dass dafuer schon ein Zugriffs-Token
 * existiert. Genau das ist der Punkt: Ein Token gibt es erst nach dem zweiten
 * Faktor.
 *
 * ## Codes nur gehasht, Vergleich zeitkonstant
 *
 * E-Mail-Codes und Wiederherstellungscodes stehen nur als HMAC-SHA256 in der
 * DB, Schluessel ist APP_KEY. Ein einfacher Hash genuegte hier NICHT: Sechs
 * Ziffern sind eine Million Moeglichkeiten, die hat ein Rechner in Sekunden
 * durch. Ohne den Schluessel (der nicht in der DB liegt) nuetzt ein Abzug der
 * Tabelle dafuer nichts. Verglichen wird mit `hash_equals`, damit die
 * Antwortzeit nicht verraet, wie viele Stellen schon stimmten.
 *
 * ## Warum Fehlversuche am Vorgang zaehlen und nicht (nur) am Rate-Limiter
 *
 * Der Rate-Limiter (AppServiceProvider) bremst pro Minute; ueber einen Tag
 * kaemen trotzdem Tausende Versuche zusammen. Die Obergrenze am Vorgang ist
 * absolut: fuenf falsche Codes, dann ist er verbraucht, und fuer den naechsten
 * braucht es wieder das Passwort. Damit hat, wer raet, fuenf Versuche auf eine
 * Million - pro Passwort-Eingabe.
 */
final class TwoFactor
{
    public const METHOD_EMAIL = 'email';

    public const METHOD_TOTP = 'totp';

    public const PURPOSE_LOGIN = 'login';

    public const PURPOSE_SETUP = 'setup';

    public const PURPOSE_CONFIRM = 'confirm';

    /** Freigabe an Node fuer DELETE /api/me - siehe server/src/routes/internal.js. */
    public const PURPOSE_DELETE = 'delete';

    /** So lange gilt ein Vorgang (und ein gemailter Code): 10 Minuten. */
    public const CODE_TTL = 600;

    /** Mindestabstand zwischen zwei Code-Mails desselben Vorgangs. */
    public const RESEND_AFTER = 60;

    /** Ab so vielen Fehlversuchen ist ein Vorgang verbraucht. */
    public const MAX_ATTEMPTS = 5;

    /**
     * Hoechstalter eines Anmelde-Vorgangs fuer neue Codes. Jede neue Mail gibt
     * dem Code wieder 10 Minuten - ohne diese Grenze liesse sich ein Vorgang
     * durch Nachfordern endlos am Leben halten.
     */
    public const MAX_AGE = 1800;

    /** Lebensdauer einer Loesch-Freigabe an Node: Sekunden, nicht Minuten. */
    public const DELETE_GRANT_TTL = 120;

    public const RECOVERY_CODE_COUNT = 8;

    /** Name in der Authenticator-App. */
    public const ISSUER = 'GÖ4Fun';

    /**
     * Zeichen der Wiederherstellungscodes: Kleinbuchstaben und Ziffern OHNE
     * die, die man verwechselt (0/o, 1/l/i). Die Codes landen auf Papier und
     * werden Monate spaeter abgetippt. 31 Zeichen hoch 8 = rund 40 Bit - bei
     * fuenf Versuchen pro Vorgang mehr als genug.
     */
    private const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

    // Ergebnisse von attempt()
    public const OK = 'ok';

    public const WRONG = 'wrong';

    public const TOO_MANY = 'too_many';

    public const EXPIRED = 'expired';

    // Meldungen - die App zeigt sie woertlich.
    public const MSG_WRONG = 'Der Code stimmt nicht.';

    public const MSG_TOO_MANY_LOGIN = 'Zu viele Versuche – bitte melde dich neu an.';

    public const MSG_EXPIRED_LOGIN = 'Der Code ist abgelaufen – bitte melde dich neu an.';

    public const MSG_TOO_MANY = 'Zu viele Versuche – fordere einen neuen Code an.';

    public const MSG_EXPIRED = 'Der Code ist abgelaufen – fordere einen neuen an.';

    public const MSG_REQUEST_FIRST = 'Fordere zuerst einen Code per E-Mail an.';

    public const MSG_CODE_REQUIRED = 'Bitte gib den Code ein.';

    public const MSG_PASSWORD_OR_CODE = 'Bitte gib dein Passwort oder einen Code ein.';

    public const MSG_PASSWORD_WRONG = 'Das Passwort stimmt nicht.';

    public const MSG_ALREADY_ACTIVE = 'Die Zwei-Faktor-Anmeldung ist schon an – schalte sie zuerst aus.';

    public const MSG_NOT_ACTIVE = 'Die Zwei-Faktor-Anmeldung ist nicht aktiv.';

    public const MSG_USES_APP = 'Deine Codes kommen aus deiner Authenticator-App.';

    public const MSG_SETUP_RESTART = 'Starte die Einrichtung bitte noch einmal.';

    public const MSG_RESEND_WAIT = 'Bitte warte kurz, bevor du einen neuen Code anforderst.';

    public const MSG_MAIL_FAILED = 'Wir konnten dir gerade keinen Code schicken – probier es gleich noch mal.';

    /* ------------------------------------------------------------ Vorgaenge */

    /**
     * Neuen Vorgang anlegen. Liefert [Vorgang, Klartext-Token].
     *
     * Der Klartext verlaesst diese Methode genau einmal - in die Antwort an die
     * App. Danach kennt ihn der Server nicht mehr.
     *
     * @return array{0: TwoFactorChallenge, 1: string}
     */
    public static function createChallenge(User $user, string $purpose, ?string $method): array
    {
        self::pruneExpired();

        $token = self::newToken();

        $challenge = TwoFactorChallenge::create([
            'user_id' => $user->getKey(),
            'token_hash' => self::hashToken($token),
            'method' => $method,
            'purpose' => $purpose,
            'attempts' => 0,
            'expires_at' => now()->addSeconds(self::CODE_TTL),
        ]);

        return [$challenge, $token];
    }

    /** Vorgang zu einem Token der App - nur passender Zweck, optional nur fuer dieses Konto. */
    public static function findChallenge(mixed $token, string $purpose, ?int $userId = null): ?TwoFactorChallenge
    {
        if (! is_string($token) || $token === '' || strlen($token) > 200) {
            return null;
        }

        return TwoFactorChallenge::query()
            ->where('token_hash', self::hashToken($token))
            ->where('purpose', $purpose)
            ->when($userId !== null, fn ($q) => $q->where('user_id', $userId))
            ->first();
    }

    /**
     * Einen Code gegen einen Vorgang pruefen - mit Zaehler, unter Sperre.
     *
     * `$verify` bekommt den frisch gelesenen, gesperrten Vorgang. Bei Erfolg
     * wird er in DERSELBEN Transaktion geloescht: Zwei gleichzeitige Anfragen
     * mit demselben richtigen Code - die zweite wartet auf die Sperre, findet
     * danach keinen Vorgang mehr und bekommt kein zweites Token.
     *
     * Der fuenfte Fehlversuch liefert schon TOO_MANY (nicht erst der sechste):
     * Die App soll in dem Moment sagen koennen „neu anmelden", in dem es
     * stimmt - nicht einen Versuch spaeter.
     */
    public static function attempt(TwoFactorChallenge $challenge, Closure $verify): string
    {
        return DB::transaction(function () use ($challenge, $verify) {
            $locked = TwoFactorChallenge::whereKey($challenge->getKey())->lockForUpdate()->first();

            if ($locked === null) {
                return self::EXPIRED;
            }
            if ($locked->attempts >= self::MAX_ATTEMPTS) {
                return self::TOO_MANY;
            }
            if ($locked->isExpired()) {
                return self::EXPIRED;
            }

            if ($verify($locked) === true) {
                $locked->delete();

                return self::OK;
            }

            $locked->increment('attempts');

            return $locked->attempts >= self::MAX_ATTEMPTS ? self::TOO_MANY : self::WRONG;
        });
    }

    /**
     * Passt der Code zu diesem Vorgang?
     *
     * Sechs Ziffern sind ein Einmal-Code - je nach Methode der gemailte oder der
     * aus der App. Alles andere wird als Wiederherstellungscode versucht (wenn
     * erlaubt). Die Form entscheidet, nicht ein Extra-Feld: Die App hat EIN
     * Eingabefeld, und wer sein Handy verloren hat, tippt dort den Code vom
     * Zettel ein.
     */
    public static function challengeCodeMatches(TwoFactorChallenge $challenge, User $user, string $code, bool $allowRecovery): bool
    {
        $otp = self::normalizeOtp($code);

        if ($otp !== null) {
            if ($challenge->method === self::METHOD_TOTP) {
                return self::verifyTotpForUser($user, $otp);
            }

            return is_string($challenge->code_hash)
                && hash_equals($challenge->code_hash, self::hashCode($challenge->token_hash, $otp));
        }

        return $allowRecovery && self::consumeRecoveryCode($user, $code);
    }

    /**
     * Code per Mail an die Konto-Adresse - und ERST DANACH den Hash speichern.
     *
     * Die Reihenfolge ist Absicht: Scheitert der Versand, gilt der alte Code
     * (falls es einen gab) weiter, statt durch einen ersetzt zu werden, der nie
     * ankam. Ein frisch angelegter Vorgang ohne zugestellten Code ist nutzlos und
     * wird geloescht. In beiden Faellen bekommt die App 503 mit einer Meldung,
     * die zum erneuten Versuchen einlaedt - und `last_sent_at` blockiert ihn
     * nicht, denn es wurde ja nichts gesendet.
     *
     * Der Code selbst taucht in KEINER Antwort auf, nur in der Mail.
     */
    public static function sendCode(TwoFactorChallenge $challenge, User $user): void
    {
        $code = sprintf('%06d', random_int(0, 999999));

        try {
            Mail::to($user->email)->send(new TwoFactorCode($code, intdiv(self::CODE_TTL, 60)));
        } catch (\Throwable $e) {
            Log::error('[two-factor] Code-Mail nicht versendet', [
                'user_id' => $user->getKey(),
                'fehler' => $e->getMessage(),
            ]);

            if ($challenge->code_hash === null) {
                $challenge->delete();
            } else {
                $challenge->forceFill(['last_sent_at' => null])->save();
            }

            throw new HttpResponseException(response()->json(['message' => self::MSG_MAIL_FAILED], 503));
        }

        $challenge->forceFill([
            'code_hash' => self::hashCode($challenge->token_hash, $code),
            'last_sent_at' => now(),
            'expires_at' => now()->addSeconds(self::CODE_TTL),
        ])->save();
    }

    /**
     * Darf fuer diesen Vorgang jetzt eine neue Mail raus? Wenn ja, wird der
     * Zeitpunkt gleich belegt (unter Sperre) - zwei gleichzeitige Klicks auf
     * „neu senden" ergeben so EINE Mail, nicht zwei, von denen nur die zweite
     * gilt. Liefert die Wartezeit in Sekunden, oder null, wenn gesendet werden darf.
     */
    public static function claimResend(TwoFactorChallenge $challenge): ?int
    {
        return DB::transaction(function () use ($challenge) {
            $locked = TwoFactorChallenge::whereKey($challenge->getKey())->lockForUpdate()->first();
            $sentAt = $locked?->last_sent_at;

            if ($sentAt !== null && $sentAt->greaterThan(now()->subSeconds(self::RESEND_AFTER))) {
                return max(1, self::RESEND_AFTER - (int) $sentAt->diffInSeconds(now(), true));
            }

            $locked?->forceFill(['last_sent_at' => now()])->save();

            return null;
        });
    }

    /** Wartezeit bis zur naechsten Mail fuer einen neuen Vorgang dieses Zwecks (0 = sofort). */
    public static function secondsUntilNextMail(User $user, string $purpose): int
    {
        $sentAt = TwoFactorChallenge::where('user_id', $user->getKey())
            ->where('purpose', $purpose)
            ->whereNotNull('last_sent_at')
            ->max('last_sent_at');

        if ($sentAt === null) {
            return 0;
        }

        $elapsed = (int) now()->diffInSeconds(Carbon::parse($sentAt), true);

        return max(0, self::RESEND_AFTER - $elapsed);
    }

    /**
     * Abgelaufene Vorgaenge wegraeumen. Laeuft bei jedem neuen Vorgang mit - ein
     * eigener Zeitplan waere ein Dienst mehr, den jemand starten muss.
     */
    public static function pruneExpired(): void
    {
        TwoFactorChallenge::where('expires_at', '<', now())->delete();
    }

    /* ---------------------------------------------------------- Anmeldung */

    /**
     * Antwort auf ein richtiges Passwort, wenn 2FA an ist: kein Token, sondern
     * ein Vorgang. Bei der E-Mail-Methode geht der Code sofort raus.
     */
    public static function startLogin(User $user): JsonResponse
    {
        $method = $user->two_factor_method;

        [$challenge, $token] = self::createChallenge($user, self::PURPOSE_LOGIN, $method);

        if ($method === self::METHOD_EMAIL) {
            self::sendCode($challenge, $user);
        }

        return response()->json([
            'two_factor' => [
                'challenge' => $token,
                'method' => $method,
                'destination' => $method === self::METHOD_EMAIL ? self::maskEmail((string) $user->email) : null,
                'expires_in' => self::CODE_TTL,
            ],
        ]);
    }

    public static function isEnabled(User $user): bool
    {
        return in_array($user->two_factor_method, [self::METHOD_EMAIL, self::METHOD_TOTP], true);
    }

    /* ------------------------------------------------------------- TOTP */

    /**
     * TOTP-Code pruefen - mit Replay-Schutz, der auch bei gleichzeitigen
     * Anfragen haelt.
     *
     * Das gemerkte Fenster wird per Vergleichen-und-Setzen in EINEM UPDATE
     * hochgezaehlt: Nur wer es schafft, `two_factor_last_step` von „kleiner"
     * auf dieses Fenster zu heben, hat gewonnen. Zwei Anfragen mit demselben
     * Code zur selben Zeit - genau eine bekommt affectedRows = 1.
     *
     * Ueber DB::table und nicht ueber das Model: Eine Anmeldung ist keine
     * Aenderung am Konto, `updated_at` bleibt stehen.
     */
    public static function verifyTotpForUser(User $user, string $code, ?string $secret = null): bool
    {
        try {
            $secret ??= $user->two_factor_secret;
        } catch (DecryptException $e) {
            // Passiert nur, wenn APP_KEY gewechselt hat. Dann passt KEIN Code
            // mehr - das soll im Log auffallen, nicht als „Code falsch" versanden.
            Log::error('[two-factor] TOTP-Secret nicht entschluesselbar (APP_KEY geaendert?)', ['user_id' => $user->getKey()]);

            return false;
        }

        if (! is_string($secret) || $secret === '') {
            return false;
        }

        $step = Totp::verify($secret, $code, $user->two_factor_last_step);
        if ($step === null) {
            return false;
        }

        $claimed = DB::table('users')
            ->where('id', $user->getKey())
            ->where(fn ($q) => $q->whereNull('two_factor_last_step')->orWhere('two_factor_last_step', '<', $step))
            ->update(['two_factor_last_step' => $step]);

        if ($claimed !== 1) {
            return false;
        }

        $user->forceFill(['two_factor_last_step' => $step])->syncOriginalAttribute('two_factor_last_step');

        return true;
    }

    /* ----------------------------------------------- Wiederherstellungscodes */

    /** Acht neue Codes im Format xxxx-xxxx (Klartext, nur fuer die Antwort). */
    public static function generateRecoveryCodes(): array
    {
        $codes = [];
        $max = strlen(self::RECOVERY_ALPHABET) - 1;

        while (count($codes) < self::RECOVERY_CODE_COUNT) {
            $raw = '';
            for ($i = 0; $i < 8; $i++) {
                $raw .= self::RECOVERY_ALPHABET[random_int(0, $max)];
            }
            // Schluessel = Rohform: doppelte Codes (unwahrscheinlich) fallen so heraus.
            $codes[$raw] = substr($raw, 0, 4).'-'.substr($raw, 4);
        }

        return array_values($codes);
    }

    /**
     * Neue Codes speichern - die alten sind damit alle ungueltig.
     *
     * @return list<string> die Klartexte
     */
    public static function replaceRecoveryCodes(User $user): array
    {
        $plain = self::generateRecoveryCodes();

        $user->two_factor_recovery_codes = self::hashRecoveryCodes($plain);
        $user->save();

        return $plain;
    }

    /**
     * Einen Wiederherstellungscode einloesen - er gilt genau einmal.
     *
     * Unter Sperre auf der Konto-Zeile: Zwei Anfragen mit demselben Code zur
     * selben Zeit - die zweite liest die Liste erst, nachdem die erste den Code
     * herausgenommen hat.
     *
     * Die Liste wird ganz durchlaufen, auch nach einem Treffer: Die Laufzeit
     * sagt dann nichts darueber, an welcher Stelle er stand.
     */
    public static function consumeRecoveryCode(User $user, string $code): bool
    {
        $normalized = self::normalizeRecoveryCode($code);
        if ($normalized === null) {
            return false;
        }

        $needle = self::hashRecoveryCode($normalized);

        return DB::transaction(function () use ($user, $needle) {
            $locked = User::whereKey($user->getKey())->lockForUpdate()->first();

            try {
                $hashes = $locked?->two_factor_recovery_codes;
            } catch (DecryptException) {
                Log::error('[two-factor] Wiederherstellungscodes nicht entschluesselbar (APP_KEY geaendert?)', ['user_id' => $user->getKey()]);

                return false;
            }

            if (! is_array($hashes)) {
                return false;
            }

            $found = null;
            foreach ($hashes as $index => $hash) {
                if (is_string($hash) && hash_equals($hash, $needle)) {
                    $found = $index;
                }
            }

            if ($found === null) {
                return false;
            }

            unset($hashes[$found]);
            $remaining = array_values($hashes);

            // Einloesen ist keine Konto-Aenderung: `updated_at` bleibt.
            $locked->timestamps = false;
            $locked->two_factor_recovery_codes = $remaining;
            $locked->save();

            // Das Model des Aufrufers mitziehen - sonst schriebe ein spaeteres
            // save() dort die alte Liste samt verbrauchtem Code zurueck.
            $user->forceFill(['two_factor_recovery_codes' => $remaining])
                ->syncOriginalAttribute('two_factor_recovery_codes');

            return true;
        });
    }

    /* ------------------------------------------------- Ein- und Ausschalten */

    /**
     * Methode einschalten; liefert die Wiederherstellungscodes im Klartext - das
     * einzige Mal, dass es sie so gibt.
     *
     * Unter Sperre und mit erneuter Pruefung, ob schon etwas an ist: Zwei
     * gleichzeitige Bestaetigungen ergaeben sonst zwei Saetze Codes, von denen
     * nur der zweite gilt - und die App zeigt vielleicht den ersten.
     *
     * `$expectedSecret` (TOTP): Das Secret, gegen das der Code gerade gepasst
     * hat. Hat eine parallele Einrichtung es inzwischen ersetzt, wird NICHT
     * eingeschaltet - sonst waere ein Secret aktiv, das in keiner App steht.
     */
    public static function enable(User $user, string $method, ?int $lastStep = null, ?string $expectedSecret = null): array
    {
        $plain = self::generateRecoveryCodes();

        DB::transaction(function () use ($user, $method, $lastStep, $expectedSecret, $plain) {
            $locked = User::whereKey($user->getKey())->lockForUpdate()->first();

            if ($locked === null || $locked->two_factor_method !== null) {
                throw self::conflict(self::MSG_ALREADY_ACTIVE);
            }

            if ($method === self::METHOD_TOTP && ! hash_equals((string) $expectedSecret, (string) $locked->two_factor_secret)) {
                throw ValidationException::withMessages(['code' => [self::MSG_SETUP_RESTART]]);
            }

            $locked->two_factor_method = $method;
            if ($method === self::METHOD_EMAIL) {
                $locked->two_factor_secret = null;
            }
            $locked->two_factor_confirmed_at = now();
            $locked->two_factor_last_step = $lastStep;
            $locked->two_factor_recovery_codes = self::hashRecoveryCodes($plain);
            $locked->save();

            TwoFactorChallenge::where('user_id', $locked->getKey())
                ->whereIn('purpose', [self::PURPOSE_SETUP, self::PURPOSE_CONFIRM])
                ->delete();
        });

        $user->refresh();

        return $plain;
    }

    /**
     * Ausschalten: alle Spalten leer, alle offenen Vorgaenge weg - auch
     * laufende Anmeldungen. Wer 2FA ausschaltet, will nicht, dass ein Code von
     * vorhin noch etwas freischaltet.
     */
    public static function disable(User $user): void
    {
        $user->forceFill([
            'two_factor_method' => null,
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_last_step' => null,
        ])->save();

        TwoFactorChallenge::where('user_id', $user->getKey())->delete();
    }

    /* ------------------------------------------- Bestaetigen heikler Aktionen */

    /**
     * Den aktuellen Code fuer eine heikle Aktion verlangen (angemeldet).
     *
     * TOTP: der Code aus der App. E-Mail: der Code aus der letzten Mail von
     * POST /api/user/two-factor/code (Zweck 'confirm'). Beide: auch ein
     * Wiederherstellungscode. Wirft 422 mit passender Meldung.
     */
    public static function assertCode(User $user, mixed $code, string $field = 'code'): void
    {
        $code = is_scalar($code) ? trim((string) $code) : '';

        if ($code === '') {
            throw ValidationException::withMessages([$field => [self::MSG_CODE_REQUIRED]]);
        }

        $otp = self::normalizeOtp($code);

        if ($otp !== null && $user->two_factor_method === self::METHOD_EMAIL) {
            $challenge = TwoFactorChallenge::where('user_id', $user->getKey())
                ->where('purpose', self::PURPOSE_CONFIRM)
                ->latest('id')
                ->first();

            if ($challenge === null) {
                throw ValidationException::withMessages([$field => [self::MSG_REQUEST_FIRST]]);
            }

            $result = self::attempt($challenge, fn (TwoFactorChallenge $locked) => self::challengeCodeMatches($locked, $user, $otp, false));

            $message = match ($result) {
                self::OK => null,
                self::WRONG => self::MSG_WRONG,
                self::TOO_MANY => self::MSG_TOO_MANY,
                default => self::MSG_EXPIRED,
            };

            if ($message !== null) {
                throw ValidationException::withMessages([$field => [$message]]);
            }

            return;
        }

        $ok = $otp !== null
            ? self::verifyTotpForUser($user, $otp)
            : self::consumeRecoveryCode($user, $code);

        if (! $ok) {
            throw ValidationException::withMessages([$field => [self::MSG_WRONG]]);
        }
    }

    /**
     * Passwort ODER aktueller Code - fuer Ausschalten und neue Codes.
     *
     * Ist ein Passwort mitgeschickt, zaehlt NUR das: Ein falsches Passwort wird
     * nicht still durch einen zufaellig mitgeschickten Code gerettet, und ein
     * Wiederherstellungscode wird nicht verbraucht, wenn das Passwort genuegt.
     */
    public static function assertPasswordOrCode(User $user, mixed $password, mixed $code): void
    {
        if (is_string($password) && $password !== '') {
            if (! Passwords::check($password, $user->password)) {
                throw ValidationException::withMessages(['password' => [self::MSG_PASSWORD_WRONG]]);
            }

            return;
        }

        if (is_scalar($code) && trim((string) $code) !== '') {
            self::assertCode($user, $code);

            return;
        }

        $hasPassword = is_string($user->password) && $user->password !== '';

        throw ValidationException::withMessages($hasPassword
            ? ['password' => [self::MSG_PASSWORD_OR_CODE]]
            : ['code' => [self::MSG_CODE_REQUIRED]]);
    }

    /* ------------------------------------------------------ Loesch-Freigabe */

    /**
     * Freigabe fuer Node: „Loeschen ist vollstaendig bestaetigt" - zwei Minuten,
     * einmal, nur fuer dieses Konto (Einloesen in server/src/routes/internal.js).
     *
     * Ablauf mit `NOW()` der DATENBANK, nicht mit der Uhr von PHP: Node
     * vergleicht mit `NOW()`, und so reden beide ueber dieselbe Uhr.
     */
    public static function createDeletionGrant(User $user): string
    {
        $token = self::newToken();

        DB::table('two_factor_challenges')->insert([
            'user_id' => $user->getKey(),
            'token_hash' => self::hashToken($token),
            'method' => $user->two_factor_method,
            'purpose' => self::PURPOSE_DELETE,
            'attempts' => 0,
            'expires_at' => DB::raw('NOW() + INTERVAL '.self::DELETE_GRANT_TTL.' SECOND'),
            'created_at' => DB::raw('NOW()'),
        ]);

        return $token;
    }

    /* ------------------------------------------------------------- Kleinkram */

    /** „s***@gmail.com" - genug, um die eigene Adresse zu erkennen, zu wenig fuer Fremde. */
    public static function maskEmail(string $email): string
    {
        $at = strrpos($email, '@');

        if ($at === false || $at === 0) {
            return '***';
        }

        return mb_substr(substr($email, 0, $at), 0, 1).'***'.substr($email, $at);
    }

    /** Sechs Ziffern (Leerzeichen erlaubt, „123 456" wie in vielen Apps) - sonst null. */
    public static function normalizeOtp(string $code): ?string
    {
        $clean = (string) preg_replace('/\s+/', '', $code);

        return preg_match('/^\d{6}$/', $clean) === 1 ? $clean : null;
    }

    /** Wiederherstellungscode in Rohform: klein, ohne Bindestrich/Leerzeichen, 8 Zeichen. */
    public static function normalizeRecoveryCode(string $code): ?string
    {
        $clean = strtolower((string) preg_replace('/[^A-Za-z0-9]/', '', $code));

        return strlen($clean) === 8 ? $clean : null;
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** Der Code haengt am Vorgang: Derselbe Code in einem anderen Vorgang ist ein anderer Hash. */
    private static function hashCode(string $tokenHash, string $code): string
    {
        return hash_hmac('sha256', 'code|'.$tokenHash.'|'.$code, self::key());
    }

    private static function hashRecoveryCode(string $normalized): string
    {
        return hash_hmac('sha256', 'recovery|'.$normalized, self::key());
    }

    /** @param list<string> $plain */
    private static function hashRecoveryCodes(array $plain): array
    {
        return array_map(
            fn (string $code) => self::hashRecoveryCode((string) self::normalizeRecoveryCode($code)),
            $plain,
        );
    }

    private static function newToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    private static function key(): string
    {
        $key = config('app.key');

        if (! is_string($key) || $key === '') {
            throw new RuntimeException('APP_KEY fehlt - ohne ihn lassen sich Codes weder hashen noch pruefen.');
        }

        return $key;
    }

    /** 409 im gewohnten Format. */
    public static function conflict(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message], 409));
    }
}
