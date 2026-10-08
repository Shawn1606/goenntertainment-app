<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Ein Stempel auf der Stempelkarte - hoechstens einer pro Partner und Tag. */
class Stamp extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['stamp_day' => 'date:Y-m-d'];
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
