<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Nur fuer Admins (`users.is_admin`). Laeuft nach `auth:sanctum`.
 *
 * 403 statt 404: Den Admin-Bereich gibt es, das ist kein Geheimnis - nur die
 * Tuer ist zu.
 */
class EnsureAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->is_admin) {
            return response()->json(['message' => 'Nur für Admins.'], 403);
        }

        return $next($request);
    }
}
