<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Eine Chat-Nachricht. `body` darf leer sein, wenn ein Angebot geteilt wurde -
 * dann ist die Karte die Nachricht. `shared_title` ist der Schnappschuss, falls
 * das Angebot spaeter verschwindet.
 */
class ChatMessage extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    protected $guarded = [];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(ChatRoom::class, 'room_id');
    }

    public function sharedOffer(): BelongsTo
    {
        return $this->belongsTo(Offer::class, 'shared_offer_id');
    }
}
