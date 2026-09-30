<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Ein Besuch beim Partner: Kunde scannt den Aufkleber (nfc/qr) oder Partner
 * scannt den Pass des Kunden (pass). Jeder Besuch wird festgehalten - auch der
 * zweite am selben Tag, der keinen Stempel mehr bringt.
 */
class Checkin extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    public const METHODS = ['nfc', 'qr', 'pass'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['stamped' => 'boolean'];
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
