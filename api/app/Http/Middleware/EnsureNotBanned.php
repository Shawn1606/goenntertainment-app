<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Weist gesperrte Konten ab - und meldet sie dabei sofort ab.
 *
 * Laeuft NACH `auth:sanctum`, denn erst dann steht fest, wer anfragt. Getrennt
 * vom Anmelde-Schritt, weil eine Sperre nichts mit der Gueltigkeit des Tokens zu
 * tun hat: Der Token ist echt, das Konto darf nur nicht mehr.
 *
 * Der benutzte Token wird geloescht (nicht alle des Kontos): Genau so hielt es
 * das vorige Backend in server/src/auth.js, und es genuegt - beim naechsten
 * Versuch eines anderen Geraets trifft es dessen Token.
 */
class EnsureNotBanned
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user !== null && $user->isBanned()) {
            $request->user()->currentAccessToken()?->delete();

            return response()->json(['message' => 'Dein Konto ist gesperrt.'], 403);
        }

        return $next($request);
    }
}
