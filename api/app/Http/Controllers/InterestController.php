<?php

namespace App\Http\Controllers;

use App\Models\Interest;
use Illuminate\Http\JsonResponse;

class InterestController extends Controller
{
    /**
     * GET /api/interests (oeffentlich)
     *
     * Oeffentlich, weil die Registrierung danach fragt, bevor es ein Konto gibt.
     * Ausgeliefert werden nur id, name, slug und icon - die Zeitstempel blendet
     * das Interest-Model aus.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Interest::orderBy('name')->get(),
        ]);
    }
}
