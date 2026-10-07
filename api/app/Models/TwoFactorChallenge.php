<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Ein offener Zwei-Faktor-Vorgang (Tabelle two_factor_challenges: angelegt von den
 * Migrationen, Referenz server/schema.sql).
 *
 * Nur `created_at`, kein `updated_at`: Ein Vorgang wird nicht „bearbeitet",
 * er zaehlt Versuche und wird verbraucht. Eine Spalte, die nie jemand liest,
 * waere nur eine Stelle mehr, die beim Schreiben stimmen muss.
 *
 * `$guarded = []` ist hier vertretbar, weil diese Zeilen NIE aus Eingaben der
 * App gebaut werden - nur aus Werten, die App\Support\TwoFactor selbst erzeugt.
 */
class TwoFactorChallenge extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    protected $table = 'two_factor_challenges';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'last_sent_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isExpired(): bool
    {
        return $this->expires_at === null || ! $this->expires_at->isFuture();
    }
}
