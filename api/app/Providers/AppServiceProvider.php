<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

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
    }

    /**
     * Bremsen fuer alles, wo jemand raten koennte - Passwoerter und Codes.
     *
     * ## Warum zwei Schluessel je Bremse
     *
     * Einer je Ziel (E-Mail-Adresse, Vorgang, Konto) und einer je IP. Nur je IP
     * liesse sich mit wechselnden Adressen umgehen und traefe zugleich ganze
     * Schulen hinter einer IP; nur je Ziel liesse eine IP beliebig viele
     * Konten durchprobieren. Zusammen bremst es beides, ohne Unbeteiligte
     * auszusperren.
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

        RateLimiter::for('login', function (Request $request) use ($tooMany) {
            $email = mb_strtolower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(10)->by('login:'.$email.'|'.$request->ip())->response($tooMany),
                Limit::perMinute(30)->by('login-ip:'.$request->ip())->response($tooMany),
            ];
        });

        RateLimiter::for('two-factor', function (Request $request) use ($tooMany) {
            $challenge = hash('sha256', (string) $request->input('challenge'));

            return [
                Limit::perMinute(10)->by('2fa:'.$challenge)->response($tooMany),
                Limit::perMinute(30)->by('2fa-ip:'.$request->ip())->response($tooMany),
            ];
        });

        // Der Abstand von 60 s je Vorgang steht in TwoFactor::claimResend; das
        // hier faengt nur ab, wer viele Vorgaenge zugleich anstoesst.
        RateLimiter::for('two-factor-resend', fn (Request $request) => [
            Limit::perMinute(10)->by('2fa-resend-ip:'.$request->ip())->response($tooMany),
        ]);

        // Einrichten/Ausschalten/Codes: angemeldet, also je Konto.
        RateLimiter::for('two-factor-setup', fn (Request $request) => [
            Limit::perMinute(10)->by('2fa-setup:'.($request->user()?->getAuthIdentifier() ?? $request->ip()))->response($tooMany),
        ]);

        // Passwort aendern und Konto loeschen: Beides prueft das Passwort, und
        // ein gestohlener Token soll es nicht in Ruhe durchprobieren koennen.
        RateLimiter::for('account-sensitive', fn (Request $request) => [
            Limit::perMinute(10)->by('account:'.($request->user()?->getAuthIdentifier() ?? $request->ip()))->response($tooMany),
        ]);
    }
}
