<?php

namespace App\Http\Controllers;

use App\Support\Features;
use App\Support\TestPhase\Board;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Was die App fuer dieses Konto zeigen darf (App\Support\Features) - und das
 * Stadt-Bingo fuer Nutzer, sobald es freigeschaltet ist.
 *
 * Das Bingo selbst rechnet weiter App\Support\TestPhase\Bingo; abgeholt wird
 * ueber Board::claim (gleiche Pruefung, gleiche Gutschrift wie im Admin-Test).
 */
class FeatureController extends Controller
{
    /** GET /api/features */
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => Features::effective($request->user())]);
    }

    /** GET /api/bingo */
    public function bingo(Request $request): JsonResponse
    {
        $this->ensureBingo($request);

        return response()->json(['data' => Board::state($request->user())['bingo']]);
    }

    /** POST /api/bingo/claim {key} - nur Bingo-Belohnungen. */
    public function claimBingo(Request $request): JsonResponse
    {
        $this->ensureBingo($request);
        $data = $request->validate(['key' => ['required', 'string', 'regex:/^bingo:(line:[0-7]|full)$/']]);
        $result = Board::claim($request->user(), $data['key']);

        return response()->json([
            'data' => $result['state']['bingo'],
            'credits' => $result['credits'],
            'balance' => (int) $request->user()->fresh()->credits_balance,
        ]);
    }

    private function ensureBingo(Request $request): void
    {
        if (! Features::enabled($request->user(), 'bingo')) {
            abort(response()->json(['message' => 'Das Stadt-Bingo ist gerade nicht aktiv.'], 403));
        }
    }
}
