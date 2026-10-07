<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Ein buchbares Angebot eines Partners.
 *
 * `kind`:
 *  - `activity` - eine Aktivitaet (Sprung-Session, Escape Room fuer 4). Taucht im
 *    Gruppen-Finder auf, hat meist einen Euro-Preis und optional einen Credit-Preis.
 *  - `perk` - ein Vorteil vor Ort (Freigetraenk, Upgrade), typischerweise nur
 *    gegen Credits.
 *
 * Die Rabatt-Obergrenze kommt aus dem Angebot, sonst vom Partner, sonst aus
 * shared/club.json (`effectiveMaxDiscount`).
 */
#[Fillable([
    'partner_id', 'kind', 'title', 'subtitle', 'description', 'interest_id', 'price_cents', 'price_credits',
    'max_discount_percent', 'min_people', 'max_people', 'min_age', 'max_age', 'duration_minutes', 'indoor',
    'valid_days', 'is_active', 'is_featured', 'sort', 'daily_capacity', 'platinum_reserved',
])]
class Offer extends Model
{
    use SerializesMysqlDates;

    public const KINDS = ['activity', 'perk'];

    protected function casts(): array
    {
        return [
            'price_cents' => 'integer',
            'price_credits' => 'integer',
            'max_discount_percent' => 'integer',
            'min_people' => 'integer',
            'max_people' => 'integer',
            'min_age' => 'integer',
            'max_age' => 'integer',
            'duration_minutes' => 'integer',
            'indoor' => 'boolean',
            'valid_days' => 'integer',
            'is_active' => 'boolean',
            'is_featured' => 'boolean',
            'sort' => 'integer',
            'daily_capacity' => 'integer',
            'platinum_reserved' => 'integer',
        ];
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function interest(): BelongsTo
    {
        return $this->belongsTo(Interest::class);
    }

    /** Aktiv UND beim aktiven Partner - nur das sieht die App. */
    public function scopeBookable(Builder $query): void
    {
        $query->where('offers.is_active', true)
            ->whereHas('partner', fn (Builder $q) => $q->where('is_active', true));
    }

    /** Welcher Deckel gilt? NULL = der allgemeine aus shared/club.json. */
    public function effectiveMaxDiscount(): ?int
    {
        return $this->max_discount_percent ?? $this->partner?->max_discount_percent;
    }
}
