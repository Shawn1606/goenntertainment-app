<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Eine Bewegung auf dem Credit-Konto. Geschrieben NUR ueber App\Support\Wallet -
 * dort stehen Stand und Zeile in derselben Transaktion.
 */
class CreditTransaction extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'balance_after' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
