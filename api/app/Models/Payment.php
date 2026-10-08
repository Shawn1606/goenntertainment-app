<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;

/**
 * Eine Zahlung - im Testmodus simuliert (App\Support\Payments), spaeter vom
 * echten Anbieter bestaetigt. `purpose`: credits | plan | booking.
 */
class Payment extends Model
{
    use SerializesMysqlDates;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['amount_cents' => 'integer'];
    }
}
