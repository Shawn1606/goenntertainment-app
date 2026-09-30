<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Eine Buchung - der Beleg, den man beim Partner vorzeigt bzw. per Check-in einloest.
 *
 * Preis, Rabatt und Stufe stehen in der Zeile, wie sie beim Buchen galten (siehe
 * App\Support\Bookings). `offer_title`/`partner_name` sind Schnappschuesse, damit
 * die Buchung lesbar bleibt, wenn das Angebot spaeter geloescht wird.
 *
 * `status`: confirmed (offen) | redeemed (eingeloest) | cancelled (storniert).
 * „Abgelaufen" ist kein gespeicherter Zustand, sondern `confirmed` mit
 * `valid_until` in der Vergangenheit (`isOpen`).
 */
class Booking extends Model
{
    use SerializesMysqlDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'people' => 'integer',
            'unit_price_cents' => 'integer',
            'unit_credits' => 'integer',
            'discount_percent' => 'float',
            'subtotal_cents' => 'integer',
            'discount_cents' => 'integer',
            'total_cents' => 'integer',
            'subtotal_credits' => 'integer',
            'total_credits' => 'integer',
            'preferred_date' => 'date:Y-m-d',
            'valid_until' => 'datetime',
            'redeemed_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function offer(): BelongsTo
    {
        return $this->belongsTo(Offer::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    /** Noch einloesbar: bestaetigt und nicht abgelaufen. */
    public function isOpen(): bool
    {
        return $this->status === 'confirmed' && $this->valid_until->isFuture();
    }

    /** Was die App als Zustand zeigt - inklusive „abgelaufen". */
    public function displayStatus(): string
    {
        if ($this->status === 'confirmed' && ! $this->valid_until->isFuture()) {
            return 'expired';
        }

        return $this->status;
    }

    public function scopeOpen(Builder $query): void
    {
        $query->where('status', 'confirmed')->where('valid_until', '>', now());
    }
}
