<?php

namespace App\Support\TestPhase;

use App\Models\Partner;
use App\Models\User;
use App\Support\Format;
use App\Support\Media;
use Illuminate\Support\Facades\DB;

/**
 * Stempel-Sammelalbum (Testphase): jeder aktive Partner als eigenes Motiv,
 * besuchte farbig mit Anzahl und erstem Besuch, die anderen noch grau. Die Farbe
 * des Motivs ist fest je Partner (aus der ID), damit es wie ein echtes Album
 * wirkt, in dem jeder Laden seinen eigenen Stempel hat.
 */
final class Album
{
    /** Kraeftige Stempelfarben - je Partner eine, fest aus der ID. */
    private const INKS = ['#e11d48', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#db2777', '#4f46e5'];

    /**
     * @return array{visited: int, total: int, stamps: list<array<string, mixed>>}
     */
    public static function state(User $user): array
    {
        $visits = DB::table('stamps')
            ->where('user_id', $user->getKey())
            ->whereNotNull('partner_id')
            ->groupBy('partner_id')
            ->selectRaw('partner_id, COUNT(*) as visits, MIN(created_at) as first_at')
            ->get()
            ->keyBy('partner_id');

        $stamps = Partner::where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'logo_path'])
            ->map(function (Partner $p) use ($visits) {
                $v = $visits->get($p->id);

                return [
                    'partner_id' => $p->id,
                    'name' => $p->name,
                    'logo_url' => Media::url($p->logo_path),
                    'ink' => self::INKS[$p->id % count(self::INKS)],
                    'visits' => (int) ($v->visits ?? 0),
                    'first_visit' => $v ? Format::iso(\Illuminate\Support\Carbon::parse($v->first_at)) : null,
                ];
            })
            // Besuchte zuerst (meiste Besuche oben), dann der Rest alphabetisch.
            ->sortBy(fn ($s) => [$s['visits'] > 0 ? 0 : 1, -$s['visits'], $s['name']])
            ->values()
            ->all();

        return [
            'visited' => count(array_filter($stamps, fn ($s) => $s['visits'] > 0)),
            'total' => count($stamps),
            'stamps' => $stamps,
        ];
    }
}
