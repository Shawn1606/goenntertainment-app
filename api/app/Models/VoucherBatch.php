<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Eine Auflage Gutscheinkarten, z. B. „500 x 100 Credits fuer REWE".
 * Die Codes erzeugt App\Support\Vouchers; der Handel verkauft die Karten.
 */
class VoucherBatch extends Model
{
    use SerializesMysqlDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'credits' => 'integer',
            'quantity' => 'integer',
            'expires_at' => 'datetime',
        ];
    }

    public function vouchers(): HasMany
    {
        return $this->hasMany(Voucher::class, 'batch_id');
    }
}
