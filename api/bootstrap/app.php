<?php

use App\Http\Middleware\EnsureNotBanned;
use App\Http\Middleware\LimitRequestBody;
use App\Http\Middleware\UnescapedJsonResponses;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
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
         * First of all: a request body over Node's limits (32 kB JSON, 16 kB urlencoded, 128 kB
         * for the RevenueCat webhook) is refused with 413, ahead of ValidatePostSize and before
         * TrimStrings and ConvertEmptyStringsToNull rebuild the decoded body (F-02).
         * public/index.php makes the same check before Request::capture(); this one covers every
         * other way into the kernel. Being first, its 413 carries no CORS headers (the app sends
         * nothing this large).
         */
        $middleware->prepend(LimitRequestBody::class);

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
         * A failed query is logged without request data (F-38): the default report writes the
         * exception's message, which is the statement with every bound value filled in
         * (addresses, names, hashes) followed by the driver's message. Logged instead: the class,
         * the SQLSTATE and the driver's error number - enough to find the failing code path in
         * the trace of a reproduction, nothing a user typed.
         */
        $exceptions->report(function (QueryException $e) {
            Log::error('Database query failed', [
                'exception' => $e::class,
                'connection' => $e->getConnectionName(),
                'sqlstate' => (string) $e->getCode(),
                'driver_code' => $e->errorInfo[1] ?? null,
            ]);
        })->stop();

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
