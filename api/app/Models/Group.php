<?php

namespace App\Models;

use App\Models\Concerns\SerializesMysqlDates;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Eine Gruppe - Leute, die zusammen etwas unternehmen und dafuer Gruppenrabatt
 * bekommen.
 *
 * Die Tabelle heisst `friend_groups`, weil GROUPS in MySQL 8 ein reserviertes
 * Wort ist. Mit Freundschaften hat sie seit dem Marktplatz-Umbau nichts mehr zu
 * tun: Beigetreten wird per Einladungscode (`invite_code`).
 *
 * Wer anlegt, ist `owner_id` und darf umbenennen, Leute entfernen, den Code neu
 * wuerfeln und die Gruppe loeschen. Alle anderen duerfen lesen, schreiben, buchen
 * und gehen.
 */
class Group extends Model
{
    use SerializesMysqlDates;

    protected $table = 'friend_groups';

    protected $guarded = [];

    /** Wie viele Leute eine Gruppe fasst - inklusive Anlegende:r. */
    public const MAX_MEMBERS = 50;

    public const MAX_NAME = 60;

    public const MAX_DESCRIPTION = 200;

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'group_members', 'group_id', 'user_id')
            ->withPivot('created_at');
    }

    public function room(): HasOne
    {
        return $this->hasOne(ChatRoom::class, 'group_id');
    }

    public function hasMember(int $userId): bool
    {
        return $this->members()->where('users.id', $userId)->exists();
    }
}
