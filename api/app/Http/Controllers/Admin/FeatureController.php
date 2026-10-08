<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Features;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Funktions-Schalter im Admin-Bereich (App\Support\Features):
 * „Funktionen fuer alle" (global) und „Nur fuer mich" (Vorschau des eigenen Kontos).
 */
class FeatureController extends Controller
{
    /** GET /api/admin/features */
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => Features::adminState($request->user())]);
    }

    /** PUT /api/admin/features/{key} {enabled} bzw. {value} - fuer ALLE Nutzer. */
    public function update(Request $request, string $key): JsonResponse
    {
        $data = $request->validate([
            'enabled' => ['nullable', 'boolean'],
            'value' => ['nullable', 'string', 'max:40'],
        ]);
        Features::setGlobal($key, $data['enabled'] ?? null, $data['value'] ?? null);

        return response()->json(['data' => Features::adminState($request->user())]);
    }

    /** PUT /api/admin/features/{key}/preview {mode} bzw. {value} - nur fuer das EIGENE Konto. */
    public function preview(Request $request, string $key): JsonResponse
    {
        $data = $request->validate([
            'mode' => ['nullable', 'string', 'max:10'],
            'value' => ['nullable', 'string', 'max:40'],
        ]);
        Features::setPreview($request->user(), $key, $data['mode'] ?? null, $data['value'] ?? null);

        return response()->json(['data' => Features::adminState($request->user())]);
    }
}
