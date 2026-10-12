<?php

namespace App\Http\Controllers;

use App\Models\ChatMessage;
use App\Models\ChatRoom;
use App\Models\Group;
use App\Models\Offer;
use App\Support\BlockedTerms;
use App\Support\Format;
use App\Support\Media;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Der Gruppen-Chat - portiert aus server/src/routes/chat.js, ohne Event-Chats.
 *
 * ## Die Regeln, unveraendert
 *
 * - Der Raum entsteht erst mit der ersten Nachricht (`ensureRoom`).
 * - Wer Mitglied ist, darf lesen und schreiben; alle anderen bekommen 404.
 * - Wer die Gruppe angelegt hat - und jeder Admin - darf jede Nachricht loeschen.
 *   Ein Admin ausserhalb der Gruppe tut das im Admin-Bereich
 *   (DELETE /api/admin/messages/{id}, Admin\ModerationController).
 * - Kein WebSocket: Die App holt mit `?after=<hoechste ID>` nach.
 * - Nachrichten blockierter Konten sieht nur, wer NICHT blockiert hat.
 *
 * Neu: Statt eines Events laesst sich ein Angebot teilen (`offer_id`) - „Wollen
 * wir das machen?" mit Karte und Preis.
 */
class ChatController extends Controller
{
    public const MAX_LENGTH = 1000;

    private const PAGE_DEFAULT = 50;

    private const PAGE_MAX = 100;

    /** GET /api/groups/{id}/messages?after=&before=&limit= */
    public function index(Request $request, int $id): JsonResponse
    {
        $group = $this->groupFor($request, $id);
        $room = ChatRoom::where('group_id', $group->id)->first();
        $me = $request->user()->getKey();

        $after = max(0, (int) $request->query('after'));
        $before = max(0, (int) $request->query('before'));
        $limit = min(self::PAGE_MAX, max(1, (int) ($request->query('limit') ?: self::PAGE_DEFAULT)));

        $messages = collect();
        if ($room) {
            $descending = $before > 0 && $after === 0;
            $messages = ChatMessage::with(['user:id,name,username,avatar', 'sharedOffer.partner'])
                ->where('room_id', $room->id)
                ->when($after > 0, fn ($q) => $q->where('id', '>', $after))
                ->when($before > 0, fn ($q) => $q->where('id', '<', $before))
                ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('user_blocks')
                    ->where('blocker_id', $me)->whereColumn('blocked_id', 'chat_messages.user_id'))
                ->orderBy('id', $descending ? 'desc' : 'asc')
                ->limit($limit)
                ->get();
            if ($descending) {
                $messages = $messages->reverse()->values();
            }
        }

        return response()->json([
            'data' => $messages->map(fn (ChatMessage $m) => $this->present($request, $m)),
            'room' => [
                'group_id' => $group->id,
                'title' => $group->name,
                'can_moderate' => $this->canModerate($request, $group),
            ],
        ]);
    }

    /** POST /api/groups/{id}/messages {body?, offer_id?} */
    public function store(Request $request, int $id): JsonResponse
    {
        $group = $this->groupFor($request, $id);
        $user = $request->user();

        // Erst die Form: Text bis MAX_LENGTH Zeichen, ein Angebot als Zahl. Eine Liste statt
        // eines Textes war sonst ein 500. Gesaeubert wird danach - das kuerzt nur.
        $data = $request->validate([
            'body' => ['bail', 'nullable', 'string', 'max:'.self::MAX_LENGTH],
            'offer_id' => ['bail', 'nullable', 'integer', 'min:1'],
        ], [
            'body.string' => 'Schreib etwas, bevor du sendest.',
            'body.max' => 'Eine Nachricht fasst höchstens '.self::MAX_LENGTH.' Zeichen.',
            'offer_id.*' => 'Dieses Angebot gibt es nicht mehr.',
        ]);

        $body = self::clean((string) ($data['body'] ?? ''));
        $offer = null;

        if (isset($data['offer_id'])) {
            // Es gibt es nur, solange es buchbar ist (aktiv, beim aktiven Partner).
            $offer = Offer::bookable()->find((int) $data['offer_id']);
            if ($offer === null) {
                throw ValidationException::withMessages(['offer_id' => ['Dieses Angebot gibt es nicht mehr.']]);
            }
        }
        if ($body === '' && $offer === null) {
            throw ValidationException::withMessages(['body' => ['Schreib etwas, bevor du sendest.']]);
        }
        // Gesperrte Begriffe: klar ablehnen statt maskieren.
        if ($body !== '' && BlockedTerms::default()->find($body, 'text') !== null) {
            throw ValidationException::withMessages(['body' => [BlockedTerms::default()->message('text')]]);
        }

        $roomId = $this->ensureRoom($group);

        $message = ChatMessage::create([
            'room_id' => $roomId,
            'user_id' => $user->getKey(),
            'body' => $body,
            'shared_offer_id' => $offer?->getKey(),
            'shared_title' => $offer?->title,
        ]);

        // Was man selbst schreibt, hat man gelesen.
        self::markRead($roomId, $user->getKey(), $message->id);

        $message->load(['user:id,name,username,avatar', 'sharedOffer.partner']);

        return response()->json(['data' => $this->present($request, $message)], 201);
    }

    /** POST /api/groups/{id}/read {message_id?} - der Stand laeuft nie zurueck. */
    public function read(Request $request, int $id): JsonResponse
    {
        $group = $this->groupFor($request, $id);
        $room = ChatRoom::where('group_id', $group->id)->first();
        if ($room) {
            $upTo = (int) $request->input('message_id') ?: (int) ChatMessage::where('room_id', $room->id)->max('id');
            self::markRead($room->id, $request->user()->getKey(), $upTo);
        }

        return response()->json(['unread' => 0]);
    }

    /** DELETE /api/messages/{id} */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $message = ChatMessage::with('room')->find($id);
        $group = $message?->room?->group_id ? Group::with('members')->find($message->room->group_id) : null;
        $me = $request->user()->getKey();

        abort_if($message === null || $group === null || ! $group->members->contains('id', $me), 404, 'Diese Nachricht gibt es nicht.');
        abort_if($message->user_id !== $me && ! $this->canModerate($request, $group), 403, 'Du kannst nur eigene Nachrichten löschen.');

        $message->delete();

        return response()->json(['message' => 'Nachricht gelöscht.']);
    }

    /**
     * Ungelesene Nachrichten je Gruppe in EINER Abfrage - fuer die Gruppenliste.
     *
     * @param  list<int>  $groupIds
     * @return array<int, int>
     */
    public static function unreadByGroup(array $groupIds, int $userId): array
    {
        if ($groupIds === []) {
            return [];
        }

        return DB::table('chat_rooms as r')
            ->join('chat_messages as m', 'm.room_id', '=', 'r.id')
            ->leftJoin('chat_reads as cr', fn ($j) => $j->on('cr.room_id', '=', 'r.id')->where('cr.user_id', '=', $userId))
            ->whereIn('r.group_id', $groupIds)
            ->where('m.user_id', '<>', $userId)
            ->whereRaw('m.id > COALESCE(cr.last_read_id, 0)')
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('user_blocks as b')
                ->where('b.blocker_id', $userId)->whereColumn('b.blocked_id', 'm.user_id'))
            ->groupBy('r.group_id')
            ->selectRaw('r.group_id, COUNT(m.id) as c')
            ->pluck('c', 'r.group_id')
            ->map(fn ($c) => (int) $c)
            ->all();
    }

    /**
     * Steuerzeichen weg (ausser Zeilenumbruch), Tab wird Leerzeichen, hoechstens
     * eine Leerzeile in Folge - wie in server/src/messaging.js.
     */
    public static function clean(string $text): string
    {
        $text = str_replace(["\r\n", "\r", "\t"], ["\n", "\n", ' '], $text);
        $text = preg_replace('/[\x00-\x09\x0B-\x1F\x7F]/u', '', $text) ?? '';
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? '';

        return trim($text);
    }

    private function groupFor(Request $request, int $id): Group
    {
        $group = Group::with('members')->find($id);
        abort_if($group === null || ! $group->members->contains('id', $request->user()->getKey()), 404, 'Diesen Chat gibt es nicht.');

        return $group;
    }

    private function canModerate(Request $request, Group $group): bool
    {
        return $group->owner_id === $request->user()->getKey() || (bool) $request->user()->is_admin;
    }

    /** Raum anlegen, falls es ihn noch nicht gibt - der eindeutige Schluessel verhindert zwei. */
    private function ensureRoom(Group $group): int
    {
        $existing = ChatRoom::where('group_id', $group->id)->value('id');
        if ($existing) {
            return (int) $existing;
        }

        DB::table('chat_rooms')->insertOrIgnore(['kind' => 'group', 'group_id' => $group->id, 'created_at' => now()]);

        return (int) ChatRoom::where('group_id', $group->id)->value('id');
    }

    private static function markRead(int $roomId, int $userId, int $messageId): void
    {
        $current = (int) DB::table('chat_reads')->where('room_id', $roomId)->where('user_id', $userId)->value('last_read_id');
        DB::table('chat_reads')->upsert(
            [['room_id' => $roomId, 'user_id' => $userId, 'last_read_id' => max($current, $messageId), 'updated_at' => now()]],
            ['room_id', 'user_id'],
            ['last_read_id', 'updated_at'],
        );
    }

    private function present(Request $request, ChatMessage $m): array
    {
        $offer = $m->sharedOffer;

        return [
            'id' => $m->id,
            'body' => $m->body ?? '',
            'created_at' => Format::iso($m->created_at),
            'is_mine' => $m->user_id === $request->user()->getKey(),
            'user' => [
                'id' => $m->user_id,
                'name' => $m->user?->name,
                'username' => $m->user?->username,
                'avatar' => Media::url($m->user?->avatar, $request),
            ],
            // Geteiltes Angebot. `offer_id` null = inzwischen weg; der Titel bleibt.
            'shared' => $m->shared_title !== null || $offer !== null ? [
                'offer_id' => $offer?->id,
                'title' => $offer?->title ?? $m->shared_title,
                'partner_name' => $offer?->partner?->name,
                'image_url' => Media::url($offer?->image_path ?? $offer?->partner?->cover_path, $request),
                'price_cents' => $offer?->price_cents,
                'price_credits' => $offer?->price_credits,
            ] : null,
        ];
    }
}
