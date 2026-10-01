<?php

use App\Http\Middleware\EnsureNotBanned;
use App\Http\Middleware\UnescapedJsonResponses;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        /**
         * Hinter einem Reverse Proxy (nginx/Traefik in Produktion) steht im
         * Schema sonst 'http' - denn der Proxy spricht per Klartext mit PHP, das
         * TLS endet eine Schicht davor. Genau dieser Wert baut in App\Support\Media
         * die Bild-Adressen. Ohne diese Zeile liefert das Backend also
         * `http://...`-URLs, und die App zeigt KEIN einziges Bild mehr: iOS (App
         * Transport Security) und Android 9+ verbieten Klartext-HTTP im
         * Release-Build. Mit dem Vertrauen auf den Proxy wird
         * `X-Forwarded-Proto` gelesen und 'https' geliefert.
         *
         * In der Entwicklung (kein Proxy, kein X-Forwarded-Proto) aendert das
         * nichts.
         *
         * Trusted is only the proxy named in config/trustedproxy.php (TRUSTED_PROXIES; in
         * production Caddy's fixed address), never '*' (F-31): with '*' every client could set
         * X-Forwarded-For itself and so choose the address that the rate limits count and that
         * the Node fallback receives. No `at:` here, so the middleware reads the addresses from
         * the config on each request. Only these three headers are read.
         */
        $middleware->trustProxies(
            headers: Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_HOST | Request::HEADER_X_FORWARDED_PROTO,
        );

        $middleware->alias([
            'banned' => EnsureNotBanned::class,
        ]);

        // Gilt fuer JEDE Antwort der API, auch fuer die Fehler-Antworten des
        // Frameworks - deshalb hier und nicht in den einzelnen Controllern.
        $middleware->api(prepend: [
            UnescapedJsonResponses::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );

        /**
         * Fehlerhafte Eingaben im gewohnten Format.
         *
         * Laravel haengt an `message` einen Zusatz, wenn mehrere Felder falsch
         * sind: „Der Name ist erforderlich. (and 3 more errors)". Die App zeigt
         * dieses Feld WOERTLICH an (siehe src/lib/api.ts) - dort stuende dann ein
         * englischer Einschub mitten in einem deutschen Satz, und die Zahl daneben
         * hilft niemandem, der ein Formular ausfuellt.
         *
         * Also: `message` ist die erste Meldung, `errors` traegt wie bisher alle.
         * Die App zeigt die erste an und markiert die Felder einzeln.
         */
        $exceptions->render(function (ValidationException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => $e->validator->errors()->first(),
                'errors' => $e->errors(),
            ], $e->status);
        });
    })->create();
