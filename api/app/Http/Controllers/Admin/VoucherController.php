<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Voucher;
use App\Models\VoucherBatch;
use App\Support\Codes;
use App\Support\Format;
use App\Support\Vouchers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Gutscheinkarten: Auflagen anlegen, Codes als CSV fuer die Druckerei holen,
 * einzelne Codes sperren (verlorene Kartenpakete).
 */
class VoucherController extends Controller
{
    /** Obergrenze je Auflage - groessere Mengen in mehreren Auflagen. */
    public const MAX_QUANTITY = 5000;

    /** GET /api/admin/voucher-batches */
    public function index(): JsonResponse
    {
        $batches = VoucherBatch::withCount([
            'vouchers',
            'vouchers as redeemed_count' => fn ($q) => $q->whereNotNull('redeemed_at'),
        ])->orderByDesc('id')->get();

        return response()->json(['data' => $batches->map(fn (VoucherBatch $b) => $this->present($b))]);
    }

    /** POST /api/admin/voucher-batches {label, retailer?, credits, quantity, expires_at?} */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'max:120'],
            'retailer' => ['nullable', 'string', 'max:80'],
            'credits' => ['required', 'integer', 'min:1', 'max:100000'],
            'quantity' => ['required', 'integer', 'min:1', 'max:'.self::MAX_QUANTITY],
            'expires_at' => ['nullable', 'date', 'after:today'],
        ], [
            'label.required' => 'Gib der Auflage einen Namen (z. B. „REWE Herbst 2026").',
            'credits.*' => 'Wie viele Credits ist eine Karte wert?',
            'quantity.*' => 'Zwischen 1 und '.self::MAX_QUANTITY.' Karten pro Auflage.',
            'expires_at.*' => 'Das Ablaufdatum muss in der Zukunft liegen.',
        ]);

        $batch = VoucherBatch::create($data + ['created_by' => $request->user()->getKey()]);
        Vouchers::generate($batch);

        return response()->json(['data' => $this->present($batch->loadCount([
            'vouchers',
            'vouchers as redeemed_count' => fn ($q) => $q->whereNotNull('redeemed_at'),
        ]))], 201);
    }

    /** GET /api/admin/voucher-batches/{batch}/codes.csv - fuer die Druckerei. */
    public function csv(VoucherBatch $batch): StreamedResponse
    {
        $filename = 'gutscheine-'.$batch->id.'.csv';

        return response()->streamDownload(function () use ($batch) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['code', 'credits', 'gueltig_bis', 'eingeloest'], ';');
            $batch->vouchers()->orderBy('id')->chunk(1000, function ($vouchers) use ($out) {
                foreach ($vouchers as $v) {
                    fputcsv($out, [
                        Codes::format($v->code),
                        $v->credits,
                        $v->expires_at?->format('Y-m-d') ?? '',
                        $v->redeemed_at ? 'ja' : 'nein',
                    ], ';');
                }
            });
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** POST /api/admin/vouchers/disable {code} - einen einzelnen Code sperren. */
    public function disable(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string']]);
        $voucher = Voucher::where('code', Codes::normalize($data['code']))->first();
        abort_if($voucher === null, 404, 'Diesen Code gibt es nicht.');

        $voucher->update(['disabled_at' => now()]);

        return response()->json(['message' => 'Code gesperrt.']);
    }

    private function present(VoucherBatch $b): array
    {
        return [
            'id' => $b->id,
            'label' => $b->label,
            'retailer' => $b->retailer,
            'credits' => $b->credits,
            'quantity' => $b->quantity,
            'created_count' => (int) ($b->vouchers_count ?? 0),
            'redeemed_count' => (int) ($b->redeemed_count ?? 0),
            'expires_at' => Format::iso($b->expires_at),
            'created_at' => Format::iso($b->created_at),
        ];
    }
}
