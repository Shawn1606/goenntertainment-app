<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Ein einzelner Gutscheincode - einmal einloesbar. */
class Voucher extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'credits' => 'integer',
            'expires_at' => 'datetime',
            'redeemed_at' => 'datetime',
            'disabled_at' => 'datetime',
        ];
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(VoucherBatch::class, 'batch_id');
    }
}
