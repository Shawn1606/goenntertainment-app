<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Der Chat einer Gruppe. Entsteht erst mit der ersten Nachricht
 * (App\Http\Controllers\ChatController::ensureRoom) - kein Raum heisst „hier
 * wurde noch nichts geschrieben".
 *
 * `kind`/`activity_id` stammen aus der Zeit der Event-Chats; neue Raeume sind
 * immer `group`.
 */
class ChatRoom extends Model
{
    use SerializesMysqlDates;

    public const UPDATED_AT = null;

    protected $guarded = [];

    public function messages(): HasMany
    {
        return $this->hasMany(ChatMessage::class, 'room_id');
    }
}
