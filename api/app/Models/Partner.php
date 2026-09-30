<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Ein Aktivitaets-Anbieter im Partnerprogramm (Jump-Halle, Escape Room, Cafe ...).
 *
 * Partner legt nur ein Admin an - das Programm ist exklusiv, wir gehen auf die
 * Anbieter zu. `checkin_token` steht auf dem NFC-/QR-Aufkleber an der Kasse und
 * geht nie an die App (die kennt ihn nur, wenn sie den Aufkleber scannt).
 */
#[Fillable([
    'slug', 'name', 'tagline', 'description', 'interest_id', 'address', 'city', 'lat', 'lng',
    'phone', 'website', 'instagram', 'opening_hours', 'max_discount_percent', 'is_active', 'is_featured',
])]
#[Hidden(['checkin_token'])]
class Partner extends Model
{
    use SerializesMysqlDates;

    protected function casts(): array
    {
        return [
            'lat' => 'float',
            'lng' => 'float',
            'is_active' => 'boolean',
            'is_featured' => 'boolean',
            'max_discount_percent' => 'integer',
        ];
    }

    public function offers(): HasMany
    {
        return $this->hasMany(Offer::class);
    }

    public function interest(): BelongsTo
    {
        return $this->belongsTo(Interest::class);
    }

    public function staff(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'partner_staff')->withPivot('role', 'created_at');
    }

    public function scopeActive(Builder $query): void
    {
        $query->where('is_active', true);
    }
}
