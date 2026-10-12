<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Format;
use App\Support\Media;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Melden und Blockieren - portiert aus server/src/routes/reports.js und friends.js.
 *
 * Der Meldeweg ist die Gegenseite zum Haftungsausschluss in den Bedingungen:
 * Wer erklaert, fuer Inhalte nicht zu haften, muss einen Weg haben, von
 * Problemen zu erfahren. Meldungen landen im Admin-Bereich - mit dem, was
 * gemeldet wurde, wie es im Moment der Meldung aussah (`snapshot`).
 *
 * Blockieren wirkt im Gruppen-Chat: Nachrichten der blockierten Person sieht man
 * nicht mehr, und in eine Gruppe der blockierten Person kommt man nicht (und
 * umgekehrt).
 */
class SafetyController extends Controller
{
    /** Was sich melden laesst. Die alten Arten (activity, post, story) nimmt die App nicht mehr an. */
    public const TARGETS = ['message', 'user', 'group', 'partner', 'offer'];

    /** Schluessel der Gruende - die Texte stehen in der App (src/domain/report-reason.ts). */
    public const REASONS = ['spam', 'harassment', 'sexual', 'violence', 'hate', 'scam', 'danger', 'other'];

    /** So viele Zeichen eines Textes haelt eine Meldung fest (`snapshot`) - eine Nachricht passt ganz hinein. */
    public const SNAPSHOT_TEXT_MAX = ChatController::MAX_LENGTH;

    /** POST /api/reports {target_type, target_id, reason, note?} */
    public function report(Request $request): JsonResponse
    {
        $data = $request->validate([
            'target_type' => ['required', Rule::in(self::TARGETS)],
            'target_id' => ['required', 'integer', 'min:1'],
            'reason' => ['required', Rule::in(self::REASONS)],
            'note' => ['nullable', 'string', 'max:500'],
        ], [
            'target_type.*' => 'Das lässt sich nicht melden.',
            'target_id.*' => 'Der gemeldete Inhalt konnte nicht gelesen werden.',
            'reason.*' => 'Wähle einen Grund für die Meldung.',
            'note.max' => 'Die Schilderung fasst höchstens 500 Zeichen.',
        ]);

        $snapshot = self::snapshot($data['target_type'], (int) $data['target_id'], $request->user()->getKey());

        try {
            DB::table('content_reports')->insert([
                'reporter_id' => $request->user()->getKey(),
                'target_type' => $data['target_type'],
                'target_id' => $data['target_id'],
                'reason' => $data['reason'],
                'note' => isset($data['note']) ? (trim($data['note']) ?: null) : null,
                'status' => 'open',
                'created_at' => now(),
                'snapshot' => $snapshot === null ? null : json_encode($snapshot, JSON_UNESCAPED_UNICODE),
            ]);
        } catch (UniqueConstraintViolationException) {
            // Schon gemeldet: kein Fehler - die Meldung liegt ja vor.
        }

        return response()->json(['message' => 'Danke! Wir schauen uns das an.'], 201);
    }

    /**
     * Was gemeldet wurde, im Moment der Meldung - der Beweis fuer den Admin-Bereich.
     *
     * Ohne ihn stand in der Meldung nur die ID: Wer gemeldet wurde, konnte den Inhalt gleich
     * danach loeschen oder umbenennen, und der Admin sah nichts mehr. Festgehalten werden Text
     * und Namen, Verfasser:in mit ID und Benutzername - nie eine E-Mail-Adresse. Eine Nachricht
     * nur, wenn die meldende Person in ihrer Gruppe ist, also sieht, was sie meldet: Wer IDs
     * raet, holt keine fremden Chats in den Admin-Bereich. Gibt es den Inhalt nicht (mehr):
     * null, die Meldung zaehlt trotzdem.
     *
     * @return array<string, mixed>|null
     */
    public static function snapshot(string $type, int $id, int $reporterId): ?array
    {
        $text = static fn (?string $value): ?string => $value === null ? null : mb_substr($value, 0, self::SNAPSHOT_TEXT_MAX);
        $person = static fn (object $row, string $prefix): ?array => $row->{$prefix.'_id'} === null ? null : [
            'id' => (int) $row->{$prefix.'_id'},
            'username' => $row->{$prefix.'_username'},
            'name' => $row->{$prefix.'_name'},
        ];

        switch ($type) {
            case 'message':
                $row = DB::table('chat_messages as m')
                    ->join('chat_rooms as r', 'r.id', '=', 'm.room_id')
                    ->join('friend_groups as g', 'g.id', '=', 'r.group_id')
                    ->join('group_members as gm', fn ($j) => $j->on('gm.group_id', '=', 'g.id')->where('gm.user_id', '=', $reporterId))
                    ->leftJoin('users as u', 'u.id', '=', 'm.user_id')
                    ->where('m.id', $id)
                    ->first(['m.body', 'm.shared_title', 'm.created_at', 'g.id as group_id', 'g.name as group_name',
                        'u.id as author_id', 'u.username as author_username', 'u.name as author_name']);

                return $row === null ? null : [
                    'text' => $text($row->body),
                    'shared_title' => $row->shared_title,
                    'author' => $person($row, 'author'),
                    'group' => ['id' => (int) $row->group_id, 'name' => $row->group_name],
                    'created_at' => Format::iso($row->created_at === null ? null : Carbon::parse($row->created_at)),
                ];

            case 'user':
                $row = DB::table('users')->where('id', $id)->first(['id as user_id', 'username as user_username', 'name as user_name']);

                return $row === null ? null : ['user' => $person($row, 'user')];

            case 'group':
                $row = DB::table('friend_groups as g')
                    ->leftJoin('users as u', 'u.id', '=', 'g.owner_id')
                    ->where('g.id', $id)
                    ->first(['g.name', 'g.description', 'u.id as owner_id', 'u.username as owner_username', 'u.name as owner_name']);

                return $row === null ? null : [
                    'name' => $row->name,
                    'description' => $text($row->description),
                    'owner' => $person($row, 'owner'),
                ];

            case 'partner':
                $name = DB::table('partners')->where('id', $id)->value('name');

                return $name === null ? null : ['name' => $name];

            case 'offer':
                $row = DB::table('offers as o')->leftJoin('partners as p', 'p.id', '=', 'o.partner_id')
                    ->where('o.id', $id)->first(['o.title', 'p.name as partner_name']);

                return $row === null ? null : ['title' => $row->title, 'partner_name' => $row->partner_name];
        }

        return null;
    }

    /** GET /api/blocks */
    public function blocks(Request $request): JsonResponse
    {
        $users = User::query()
            ->join('user_blocks', 'user_blocks.blocked_id', '=', 'users.id')
            ->where('user_blocks.blocker_id', $request->user()->getKey())
            ->orderBy('users.name')
            ->get(['users.id', 'users.name', 'users.username', 'users.avatar']);

        return response()->json([
            'data' => $users->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'avatar' => Media::url($u->avatar, $request),
            ]),
        ]);
    }

    /** POST /api/blocks {user_id} */
    public function block(Request $request): JsonResponse
    {
        $data = $request->validate(['user_id' => ['required', 'integer']], ['user_id.*' => 'Wen möchtest du blockieren?']);
        $me = $request->user()->getKey();

        if ((int) $data['user_id'] === $me) {
            throw ValidationException::withMessages(['user_id' => ['Dich selbst kannst du nicht blockieren.']]);
        }
        abort_unless(User::whereKey($data['user_id'])->exists(), 404, 'Dieses Konto gibt es nicht.');

        DB::table('user_blocks')->insertOrIgnore([
            'blocker_id' => $me,
            'blocked_id' => (int) $data['user_id'],
            'created_at' => now(),
        ]);

        return response()->json(['message' => 'Blockiert. Du siehst die Nachrichten dieser Person nicht mehr.'], 201);
    }

    /** DELETE /api/blocks/{userId} */
    public function unblock(Request $request, int $userId): JsonResponse
    {
        DB::table('user_blocks')->where('blocker_id', $request->user()->getKey())->where('blocked_id', $userId)->delete();

        return response()->json(['message' => 'Blockierung aufgehoben.']);
    }
}
