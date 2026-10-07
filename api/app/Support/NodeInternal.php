<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Laravel's calls to Node's internal routes (server/src/routes/internal.js).
 *
 * These routes are not part of the public API: they live under /internal, which the public
 * fallback never forwards to (NodeFallbackController forwards /api paths only), and Node answers
 * them only with the shared secret NODE_INTERNAL_SECRET (config services.node_fallback.
 * internal_secret). Without a Node address or a long enough secret nothing is called and the
 * answer is a 503 (fail closed).
 */
final class NodeInternal
{
    /** Shortest accepted secret; the same rule as INTERNAL_SECRET_MIN_LENGTH in server/src/config.js. */
    public const SECRET_MIN_LENGTH = 32;

    /**
     * Deletes the account in Node (data and files, server/src/account-deletion.js) after Laravel
     * has checked everything. $grant is the one-time deletion grant (TwoFactor::createDeletionGrant).
     * Node's answer (200, 403 expired grant, 409 last admin, ...) is passed through.
     */
    public static function deleteAccount(User $user, string $grant): Response
    {
        $base = rtrim((string) config('services.node_fallback.url'), '/');
        $secret = (string) config('services.node_fallback.internal_secret');

        if ($base === '' || strlen($secret) < self::SECRET_MIN_LENGTH) {
            Log::error('Node internal call not configured (NODE_FALLBACK_URL, NODE_INTERNAL_SECRET).');

            return response()->json(['message' => 'Serverfehler.'], 503);
        }

        try {
            $upstream = Http::withHeaders([
                'X-Internal-Secret' => $secret,
                'X-Account-Deletion-Grant' => $grant,
                'Accept' => 'application/json',
            ])
                ->withoutRedirecting()
                ->timeout(30)
                ->delete($base.'/internal/accounts/'.$user->getKey());
        } catch (\Throwable $e) {
            // The exception class only: its message carries the URL.
            Log::error('Node internal call failed', ['exception' => $e::class]);

            return response()->json(['message' => 'Serverfehler.'], 502);
        }

        return response($upstream->body(), $upstream->status())
            ->header('Content-Type', $upstream->header('Content-Type') ?: 'application/json');
    }
}
