<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Eine Challenge der Testphase (App\Support\TestPhase\Board). Nur Admins sehen
 * und spielen sie; angelegt werden sie auf dem Admin-Bildschirm „Test".
 */
class TestphaseChallenge extends Model
{
    use SerializesMysqlDates;

    public const TYPES = ['monthly', 'weekly', 'season', 'group', 'partner'];

    public const PERIODS = ['month', 'week', 'range'];

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'target' => 'integer',
            'reward_credits' => 'integer',
            'starts_at' => 'date',
            'ends_at' => 'date',
            'plans' => 'array',
            'is_active' => 'boolean',
            'is_secret' => 'boolean',
            'is_choice' => 'boolean',
            'sort' => 'integer',
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
}
