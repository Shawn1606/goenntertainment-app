<?php

namespace App\Providers;

use App\Support\RateLimitKeys;
use App\Support\RateLimitRules;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();

        /*
         * A token is valid only with an expiry date that has not passed (F-20), the rule Node's
         * requireAuth applies too. Sanctum alone accepts a token without `expires_at` (it then
         * checks only its age against sanctum.expiration); tokens from before expiry existed
         * have none and end here. App\Support\Sessions issues every token with one.
         */
        Sanctum::authenticateAccessTokensUsing(
            static fn (PersonalAccessToken $token, bool $isValid): bool => $isValid && $token->expires_at !== null,
        );
    }

    /**
     * Bremsen fuer alles, wo jemand raten koennte - Passwoerter und Codes.
     *
     * ## Warum mehrere Schluessel je Bremse
     *
     * Einer je Ziel (E-Mail-Adresse, Vorgang, Konto) und einer je IP. Nur je IP
     * liesse sich mit wechselnden Adressen umgehen und traefe zugleich ganze
     * Schulen hinter einer IP; nur je Ziel liesse eine IP beliebig viele
     * Konten durchprobieren. Zusammen bremst es beides, ohne Unbeteiligte
     * auszusperren.
     *
     * The per-account scope counts one account across every client address (F-01/F-19 review:
     * rotating addresses must not reset the count). Numbers and scopes: config/ratelimits.php;
     * keys: App\Support\RateLimitKeys; the counters live in the database cache store.
     *
     * ## Warum eine eigene Antwort
     *
     * Laravels Vorgabe ist „Too Many Attempts." - englisch, und die App zeigt
     * `message` woertlich an. Die Kopfzeilen (Retry-After, X-RateLimit-*)
     * bleiben, damit die App auf Wunsch einen Countdown zeigen kann.
     *
     * Die Zahlen sind grosszuegig fuer Menschen (niemand tippt zehnmal pro
     * Minute ein Passwort) und knapp fuer Skripte. Die eigentliche Obergrenze
     * fuer Codes ist ohnehin absolut: fuenf Fehlversuche je Vorgang (siehe
     * App\Support\TwoFactor).
     */
    private function configureRateLimiting(): void
    {
        $tooMany = static fn (Request $request, array $headers) => response()->json(
            ['message' => 'Zu viele Versuche – bitte warte kurz und probier es dann noch mal.'],
            429,
            $headers,
        );

        $limits = static fn (string $limiter, array $keys) => RateLimitRules::limits($limiter, $keys, $tooMany);

        RateLimiter::for('register', static fn (Request $request) => $limits('register', [
            'ip' => RateLimitKeys::ip($request),
            'account' => RateLimitKeys::account($request->input('email')),
        ]));

        RateLimiter::for('login', static function (Request $request) use ($limits) {
            $account = RateLimitKeys::account($request->input('email'));
            $ip = RateLimitKeys::ip($request);

            return $limits('login', ['account_ip' => $account.'|'.$ip, 'ip' => $ip, 'account' => $account]);
        });

        RateLimiter::for('password-forgot', static fn (Request $request) => $limits('password-forgot', [
            'ip' => RateLimitKeys::ip($request),
            'account' => RateLimitKeys::account($request->input('email')),
        ]));

        RateLimiter::for('password-reset', static fn (Request $request) => $limits('password-reset', [
            'ip' => RateLimitKeys::ip($request),
            'account' => RateLimitKeys::account($request->input('email')),
        ]));

        RateLimiter::for('two-factor', static fn (Request $request) => $limits('two-factor', [
            'challenge' => hash('sha256', is_scalar($request->input('challenge')) ? (string) $request->input('challenge') : ''),
            'ip' => RateLimitKeys::ip($request),
            'account' => RateLimitKeys::challengeAccount($request->input('challenge')),
        ]));

        // Der Abstand von 60 s je Vorgang steht in TwoFactor::claimResend; das
        // hier faengt ab, wer viele Vorgaenge zugleich anstoesst.
        RateLimiter::for('two-factor-resend', static fn (Request $request) => $limits('two-factor-resend', [
            'ip' => RateLimitKeys::ip($request),
            'account' => RateLimitKeys::challengeAccount($request->input('challenge')),
        ]));

        // Einrichten/Ausschalten/Codes: angemeldet, also je Konto.
        RateLimiter::for('two-factor-setup', static fn (Request $request) => $limits('two-factor-setup', [
            'user' => RateLimitKeys::user($request),
        ]));

        // Passwort aendern, E-Mail-Adresse aendern und Konto loeschen: Alle pruefen
        // das Passwort, und ein gestohlener Token soll es nicht in Ruhe
        // durchprobieren koennen. One budget for all three.
        RateLimiter::for('account-sensitive', static fn (Request $request) => $limits('account-sensitive', [
            'user' => RateLimitKeys::user($request),
        ]));

        // PATCH /user: name, username and interests (no password check; a write with the word filter).
        RateLimiter::for('profile', static fn (Request $request) => $limits('profile', [
            'user' => RateLimitKeys::user($request),
        ]));
    }
}
