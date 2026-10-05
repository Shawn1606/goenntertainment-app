<?php

namespace App\Support;

use App\Mail\TwoFactorCode;
use App\Models\TwoFactorChallenge;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Closure;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
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
 * ('setup'), das Bestaetigen heikler Aktionen per E-Mail ('confirm'). The password reset
 * code ('reset') lives there too, with its own rules (App\Support\PasswordReset), and so does the
 * code that proves control of the new address of an e-mail change while signed in ('new_email';
 * App\Support\AddressCode).
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
 *
 * ## And per account (F-19)
 *
 * Whoever knows the password can start a new challenge as often as the limiters allow, so the
 * per-challenge cap alone still adds up. Every wrong code also counts per ACCOUNT, across all
 * challenges and step-ups (sign-in, switching on and off, recovery codes, e-mail change, account
 * deletion, and the codes of App\Support\AddressCode): at the cap (config ratelimits.two-factor-failures, default 10 in 15 minutes) no
 * code is checked, no sign-in challenge is started and no code is mailed until the window has
 * passed. The count lives in the cache store (the database in the deploy) and is not reset by a
 * right code. A known password can therefore lock the second factor for the window: that is
 * the price of the cap.
 *
 * Looking at the count, checking a code and counting it run under one lock per account
 * (withAccountLock): requests at the same time take turns, so the cap is exact, not "the cap
 * plus the number of PHP workers".
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

    /**
     * A password reset code (F-09), signed out: App\Support\PasswordReset. It has its own counting
     * and never goes through attempt(), so wrong reset codes do not feed the account's cap below.
     */
    public const PURPOSE_RESET = 'reset';

    /**
     * A code mailed to the NEW address of an e-mail change (F-04), signed in: the address takes
     * effect only with it (App\Support\AddressCode, AccountController::confirmEmail).
     */
    public const PURPOSE_NEW_EMAIL = 'new_email';

    /** So lange gilt ein Vorgang (und ein gemailter Code): 10 Minuten. */
    public const CODE_TTL = 600;

    /** Mindestabstand zwischen zwei Code-Mails desselben Vorgangs. */
    public const RESEND_AFTER = 60;

    /** Ab so vielen Fehlversuchen ist ein Vorgang verbraucht. */
    public const MAX_ATTEMPTS = 5;

    /** The account's lock ends by itself after this long if its holder dies (seconds). */
    private const ACCOUNT_LOCK_SECONDS = 10;

    /** Pause between two tries to get the account's lock (milliseconds). */
    private const ACCOUNT_LOCK_RETRY_MS = 50;

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

    /** The account's failure cap is reached (see the class comment); nothing was checked. */
    public const LOCKED = 'locked';

    // Meldungen - die App zeigt sie woertlich.
    public const MSG_WRONG = 'Der Code stimmt nicht.';

    public const MSG_TOO_MANY_LOGIN = 'Zu viele Versuche – bitte melde dich neu an.';

    public const MSG_EXPIRED_LOGIN = 'Der Code ist abgelaufen – bitte melde dich neu an.';

    public const MSG_TOO_MANY = 'Zu viele Versuche – fordere einen neuen Code an.';

    public const MSG_EXPIRED = 'Der Code ist abgelaufen – fordere einen neuen an.';

    public const MSG_REQUEST_FIRST = 'Fordere zuerst einen Code per E-Mail an.';

    public const MSG_CODE_REQUIRED = 'Bitte gib den Code ein.';

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
     * `$prune` false skips the clean-up of expired challenges, for a caller that runs this inside
     * a transaction and prunes before it (PasswordReset::issue): the clean-up touches every
     * account's rows and should not hold their locks for a whole transaction.
     *
     * @return array{0: TwoFactorChallenge, 1: string}
     */
    public static function createChallenge(User $user, string $purpose, ?string $method, bool $prune = true): array
    {
        if ($prune) {
            self::pruneExpired();
        }

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
     *
     * `$onSuccess` (the sign-in: it writes the token) runs in the same transaction, right after
     * the challenge is deleted, with the account's row as its argument. That row is then locked
     * first, before the challenge, in the order of every other lock on both (password reset,
     * e-mail change). A credential change that revokes sessions thus either ends the challenge
     * before this transaction, or waits for it and revokes the token written here
     * (App\Support\Sessions, "Sign-ins under way"). Without it, a reset could commit between
     * the deletion of the challenge and a token written afterwards, and the token survived it.
     */
    public static function attempt(TwoFactorChallenge $challenge, Closure $verify, ?Closure $onSuccess = null): string
    {
        // Cap, check and count as one step per account (see withAccountLock).
        return self::withAccountLock($challenge->user_id, function () use ($challenge, $verify, $onSuccess): string {
            // The account's cap first: at the cap no code is even looked at.
            if (self::accountLocked($challenge->user_id)) {
                return self::LOCKED;
            }

            $guessed = false;
            $result = DB::transaction(function () use ($challenge, $verify, $onSuccess, &$guessed) {
                $account = null;
                if ($onSuccess !== null) {
                    $account = User::whereKey($challenge->user_id)->lockForUpdate()->first();
                    if ($account === null) {
                        return self::EXPIRED;
                    }
                }

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
                    if ($onSuccess !== null) {
                        $onSuccess($account);
                    }

                    return self::OK;
                }

                $locked->increment('attempts');
                $guessed = true;

                return $locked->attempts >= self::MAX_ATTEMPTS ? self::TOO_MANY : self::WRONG;
            });

            // Counted after the transaction, in the cache store: a rollback must not undo it.
            if ($guessed) {
                self::recordFailure($challenge->user_id);
            }

            return $result;
        });
    }

    /* --------------------------------------------- Fehlversuche je Konto (F-19) */

    /**
     * Runs $callback - look at the account's cap, check a code, count it if it was wrong - while
     * holding the account's lock. Without the lock, requests that arrive at the same time all read
     * a count below the cap before any of them is counted, and a burst gets about as many codes
     * checked as there are PHP workers. With it they take turns, so the cap is exact. Every place
     * that checks a second-factor code goes through here: attempt() (sign-in, e-mail setup,
     * mailed step-up codes), assertCode() (app and recovery codes) and the app setup
     * (TwoFactorController::confirmTotp).
     *
     * The lock lives in the cache store next to the counters (the database in the deploy: table
     * cache_locks), so it holds across PHP processes and containers. It is taken outside any
     * database transaction: inside one, its row would reach the other connections only at the
     * commit. A request that cannot get it in time (config ratelimits.lock-wait, 5 s by default)
     * gets the limiters' 429 answer, and nothing was checked or counted.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public static function withAccountLock(int|string $userId, Closure $callback): mixed
    {
        try {
            return Cache::lock("two-factor-account:{$userId}", self::ACCOUNT_LOCK_SECONDS)
                ->betweenBlockedAttemptsSleepFor(self::ACCOUNT_LOCK_RETRY_MS)
                ->block(RateLimitRules::lockWaitSeconds(), $callback);
        } catch (LockTimeoutException) {
            throw new HttpResponseException(
                response()->json(['message' => AppServiceProvider::MSG_TOO_MANY], 429)->header('Retry-After', '1'),
            );
        }
    }

    /** @return list<array{max: int, seconds: int}> */
    private static function failureRules(): array
    {
        return RateLimitRules::parse(config('ratelimits.two-factor-failures.account'));
    }

    private static function failureKey(int|string $userId, int $seconds): string
    {
        return "two-factor-failures:{$userId}:{$seconds}";
    }

    /** Has the account reached its cap of wrong codes? */
    public static function accountLocked(int|string $userId): bool
    {
        foreach (self::failureRules() as $rule) {
            if (RateLimiter::tooManyAttempts(self::failureKey($userId, $rule['seconds']), $rule['max'])) {
                return true;
            }
        }

        return false;
    }

    /** Counts one wrong code for the account (every rule of the cap); call it inside withAccountLock. */
    public static function recordFailure(int|string $userId): void
    {
        foreach (self::failureRules() as $rule) {
            RateLimiter::hit(self::failureKey($userId, $rule['seconds']), $rule['seconds']);
        }
    }

    /** "… bitte warte N Minuten …", with the time left until the cap ends. */
    public static function lockedMessage(int|string $userId): string
    {
        $seconds = 0;
        foreach (self::failureRules() as $rule) {
            $key = self::failureKey($userId, $rule['seconds']);
            if (RateLimiter::tooManyAttempts($key, $rule['max'])) {
                $seconds = max($seconds, RateLimiter::availableIn($key));
            }
        }
        $minutes = max(1, (int) ceil($seconds / 60));

        return $minutes === 1
            ? 'Zu viele falsche Codes – bitte warte eine Minute und versuch es dann noch mal.'
            : "Zu viele falsche Codes – bitte warte {$minutes} Minuten und versuch es dann noch mal.";
    }

    /** Throws the cap's 422 on $field when the account is at its cap. */
    public static function refuseIfLocked(User $user, string $field): void
    {
        if (self::accountLocked($user->getKey())) {
            throw ValidationException::withMessages([$field => [self::lockedMessage($user->getKey())]]);
        }
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
     * Der Code selbst taucht in KEINER Antwort auf, nur in der Mail - and never in a log: CodeMail
     * refuses the log mailer, which then counts as a failed mail.
     */
    public static function sendCode(TwoFactorChallenge $challenge, User $user): void
    {
        $code = sprintf('%06d', random_int(0, 999999));

        try {
            CodeMail::send((string) $user->email, new TwoFactorCode($code, intdiv(self::CODE_TTL, 60)));
        } catch (\Throwable $e) {
            // The exception class only (F-38): a transport message can name the recipient.
            Log::error('[two-factor] Code-Mail nicht versendet', [
                'user_id' => $user->getKey(),
                'exception' => $e::class,
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
        // At the account's cap: no challenge, no code mail (F-19). The caller has proven the
        // password, so the answer tells nothing new; on `email`, where the sign-in form shows it.
        self::refuseIfLocked($user, 'email');

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
                self::LOCKED => self::lockedMessage($user->getKey()),
                default => self::MSG_EXPIRED,
            };

            if ($message !== null) {
                throw ValidationException::withMessages([$field => [$message]]);
            }

            return;
        }

        // App codes and recovery codes count toward the account's cap like mailed ones (F-19),
        // looked at, checked and counted under the account's lock like them.
        self::withAccountLock($user->getKey(), function () use ($user, $otp, $code, $field): void {
            self::refuseIfLocked($user, $field);

            $ok = $otp !== null
                ? self::verifyTotpForUser($user, $otp)
                : self::consumeRecoveryCode($user, $code);

            if (! $ok) {
                self::recordFailure($user->getKey());

                throw ValidationException::withMessages([$field => [self::MSG_WRONG]]);
            }
        });
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

    /**
     * Der Code haengt am Vorgang: Derselbe Code in einem anderen Vorgang ist ein anderer Hash.
     * Public for the password reset code (PasswordReset), which is stored the same way.
     */
    public static function hashCode(string $tokenHash, string $code): string
    {
        return hash_hmac('sha256', 'code|'.$tokenHash.'|'.$code, self::key());
    }

    /**
     * A code that proves control of $address (App\Support\AddressCode): the HMAC covers the
     * challenge AND the address the code was mailed to, so the code confirms that address and no
     * other, and the address itself is not stored.
     */
    public static function hashAddressCode(string $tokenHash, string $code, string $address): string
    {
        return hash_hmac('sha256', 'address|'.$tokenHash.'|'.$code.'|'.$address, self::key());
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
