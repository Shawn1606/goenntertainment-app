<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\Group;
use App\Models\User;
use App\Rules\NoBlockedTerms;
use App\Support\Codes;
use App\Support\Format;
use App\Support\Media;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Gruppen: anlegen, per Einladungscode beitreten, verwalten.
 *
 * ## Warum ein Code statt einer Freundesliste
 *
 * Freunde gibt es seit dem Marktplatz-Umbau nicht mehr. Wer in eine Gruppe soll,
 * bekommt den Link oder den Code (per WhatsApp, persoenlich ...) und tritt SELBST
 * bei. Das ist sogar die bessere Regel als vorher: Niemand landet ungefragt in
 * einer Gruppe, denn beitreten kann nur, wer den Code bewusst eingibt.
 *
 * Wer anlegt, darf den Code neu wuerfeln - dann taugen alte Links nicht mehr.
 *
 * Wer nicht Mitglied ist, bekommt 404 und nicht 403: Eine Gruppe soll nicht
 * verraten, dass es sie gibt.
 */
class GroupController extends Controller
{
    /** GET /api/groups */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $groups = $user->groups()->with('members')->orderByDesc('friend_groups.created_at')->orderByDesc('friend_groups.id')->get();
        $unread = ChatController::unreadByGroup($groups->pluck('id')->all(), $user->getKey());

        return response()->json([
            'data' => $groups->map(fn (Group $g) => $this->present($request, $g, $unread[$g->id] ?? 0)),
        ]);
    }

    /** GET /api/groups/{id} */
    public function show(Request $request, int $id): JsonResponse
    {
        $group = $this->forMember($request, $id);
        $unread = ChatController::unreadByGroup([$group->id], $request->user()->getKey());

        return response()->json(['data' => $this->present($request, $group, $unread[$group->id] ?? 0, withBookings: true)]);
    }

    /** POST /api/groups {name, description?} */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $user = $request->user();

        $group = DB::transaction(function () use ($data, $user) {
            $group = Group::create([
                'owner_id' => $user->getKey(),
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'invite_code' => Codes::unique(8, fn (string $c) => Group::where('invite_code', $c)->exists()),
            ]);
            $group->members()->attach($user->getKey(), ['created_at' => now()]);

            return $group;
        });

        return response()->json(['data' => $this->present($request, $group->load('members'))], 201);
    }

    /** PATCH /api/groups/{id} - nur wer angelegt hat. */
    public function update(Request $request, int $id): JsonResponse
    {
        $group = $this->forMember($request, $id);
        $this->assertOwner($request, $group, 'Nur wer die Gruppe angelegt hat, kann sie umbenennen.');

        $data = $this->validated($request, $group);
        $group->update(array_intersect_key($data, array_flip(['name', 'description'])));

        return response()->json(['data' => $this->present($request, $group->load('members'))]);
    }

    /** POST /api/groups/{id}/invite-code - neuer Code, alte Links sind ungueltig. */
    public function rotateCode(Request $request, int $id): JsonResponse
    {
        $group = $this->forMember($request, $id);
        $this->assertOwner($request, $group, 'Nur wer die Gruppe angelegt hat, kann den Code erneuern.');

        $group->update(['invite_code' => Codes::unique(8, fn (string $c) => Group::where('invite_code', $c)->exists())]);

        return response()->json(['data' => $this->present($request, $group->load('members'))]);
    }

    /** GET /api/groups/invite/{code} - Vorschau vor dem Beitreten. */
    public function preview(Request $request, string $code): JsonResponse
    {
        $group = $this->byCode($code);
        $isMember = $group->hasMember($request->user()->getKey());

        return response()->json([
            'data' => [
                'id' => $isMember ? $group->id : null,
                'name' => $group->name,
                'description' => $group->description,
                'members_count' => $group->members()->count(),
                'owner_name' => $group->owner?->name,
                'is_member' => $isMember,
            ],
        ]);
    }

    /** POST /api/groups/join {code} */
    public function join(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:200']], ['code.*' => 'Gib den Einladungscode ein.']);
        $group = $this->byCode($data['code']);
        $user = $request->user();

        DB::transaction(function () use ($group, $user) {
            // Die Gruppe sperren und die Mitglieder unter der Sperre lesen: Zwei Beitritte
            // gleichzeitig zaehlten sonst dieselben Mitglieder und kaemen zusammen ueber
            // MAX_MEMBERS, und ein Doppeltipp liefe in den doppelten Schluessel (500).
            Group::whereKey($group->getKey())->lockForUpdate()->value('id');
            $members = DB::table('group_members')->where('group_id', $group->getKey())->lockForUpdate()->pluck('user_id')
                ->map(fn ($id) => (int) $id);

            // Schon Mitglied (auch: der zweite Tipp eines Doppeltipps) - nichts zu tun.
            if ($members->contains($user->getKey())) {
                return;
            }
            if ($members->count() >= Group::MAX_MEMBERS) {
                throw ValidationException::withMessages(['code' => ['Diese Gruppe ist voll ('.Group::MAX_MEMBERS.' Leute).']]);
            }
            $blocked = DB::table('user_blocks')
                ->where(fn ($q) => $q->where('blocker_id', $group->owner_id)->where('blocked_id', $user->getKey()))
                ->orWhere(fn ($q) => $q->where('blocker_id', $user->getKey())->where('blocked_id', $group->owner_id))
                ->exists();
            if ($blocked) {
                throw ValidationException::withMessages(['code' => ['Dieser Gruppe kannst du nicht beitreten.']]);
            }

            try {
                // Eigener Sicherungspunkt: Scheitert nur dieser INSERT am Schluessel, ist die
                // Person eben schon drin - kein Fehler.
                DB::transaction(fn () => $group->members()->attach($user->getKey(), ['created_at' => now()]));
            } catch (UniqueConstraintViolationException) {
                // Schon Mitglied.
            }
        });

        return response()->json(['data' => $this->present($request, $group->load('members'))]);
    }

    /**
     * DELETE /api/groups/{id}/members/{userId} - jemanden entfernen oder selbst
     * gehen. Wer angelegt hat, geht nicht, sondern loescht die Gruppe.
     */
    public function removeMember(Request $request, int $id, int $userId): JsonResponse
    {
        $group = $this->forMember($request, $id);
        $self = $userId === $request->user()->getKey();

        if (! $self) {
            $this->assertOwner($request, $group, 'Nur wer die Gruppe angelegt hat, kann Leute entfernen.');
        }
        if ($userId === $group->owner_id) {
            throw ValidationException::withMessages(['member' => ['Lösche die Gruppe, wenn du sie nicht mehr brauchst.']]);
        }

        $group->members()->detach($userId);
        // Der Lesestand geht mit - wer wieder beitritt, soll nicht auf einem
        // uralten Stand sitzen.
        if ($group->room) {
            DB::table('chat_reads')->where('room_id', $group->room->id)->where('user_id', $userId)->delete();
        }

        if ($self) {
            return response()->json(['message' => 'Gruppe verlassen.']);
        }

        return response()->json(['data' => $this->present($request, $group->load('members'))]);
    }

    /** DELETE /api/groups/{id} - nur wer angelegt hat. Chat und Mitglieder gehen mit (CASCADE). */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $group = $this->forMember($request, $id);
        $this->assertOwner($request, $group, 'Nur wer die Gruppe angelegt hat, kann sie löschen.');
        $group->delete();

        return response()->json(['message' => 'Gruppe gelöscht.']);
    }

    private function validated(Request $request, ?Group $group): array
    {
        $rules = [
            'name' => [$group ? 'sometimes' : 'required', 'bail', 'string', 'max:'.Group::MAX_NAME],
            'description' => ['sometimes', 'nullable', 'bail', 'string', 'max:'.Group::MAX_DESCRIPTION],
        ];
        // Gesperrte Begriffe nur bei NEUEN Werten - ein Altname soll das Aendern
        // der Beschreibung nicht blockieren.
        if (! $group || $request->input('name') !== $group->name) {
            $rules['name'][] = new NoBlockedTerms('name');
        }
        if (! $group || $request->input('description') !== $group->description) {
            $rules['description'][] = new NoBlockedTerms('text');
        }

        $data = $request->validate($rules, [
            'name.required' => 'Gib der Gruppe einen Namen.',
            'name.string' => 'Gib der Gruppe einen Namen.',
            'name.max' => 'Der Name fasst höchstens '.Group::MAX_NAME.' Zeichen.',
            'description.max' => 'Die Beschreibung fasst höchstens '.Group::MAX_DESCRIPTION.' Zeichen.',
        ]);

        if (isset($data['name'])) {
            $data['name'] = trim($data['name']);
            if ($data['name'] === '') {
                throw ValidationException::withMessages(['name' => ['Gib der Gruppe einen Namen.']]);
            }
        }
        if (array_key_exists('description', $data)) {
            $data['description'] = trim((string) $data['description']) ?: null;
        }

        return $data;
    }

    private function forMember(Request $request, int $id): Group
    {
        $group = Group::with('members')->find($id);
        abort_if($group === null || ! $group->members->contains('id', $request->user()->getKey()), 404, 'Diese Gruppe gibt es nicht.');

        return $group;
    }

    private function byCode(string $input): Group
    {
        $code = Codes::normalize($input);
        // Links enden auf den Code (.../g/ABCD2345) - wer den ganzen Link einfuegt,
        // meint die letzten acht Zeichen.
        $code = strlen($code) > 8 ? substr($code, -8) : $code;
        $group = Group::where('invite_code', $code)->first();
        abort_if($group === null, 404, 'Diesen Einladungscode gibt es nicht (mehr).');

        return $group;
    }

    private function assertOwner(Request $request, Group $group, string $message): void
    {
        abort_if($group->owner_id !== $request->user()->getKey(), 403, $message);
    }

    /** Eine Gruppe, wie die App sie zeigt. Wer angelegt hat zuerst, dann nach Namen. */
    private function present(Request $request, Group $group, int $unread = 0, bool $withBookings = false): array
    {
        $me = $request->user()->getKey();
        $members = $group->members
            ->sortBy(fn (User $u) => [$u->id === $group->owner_id ? 0 : 1, mb_strtolower($u->name)])
            ->values()
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'username' => $u->username,
                'avatar' => Media::url($u->avatar, $request),
                'is_owner' => $u->id === $group->owner_id,
            ]);

        $data = [
            'id' => $group->id,
            'name' => $group->name,
            'description' => $group->description,
            'created_at' => Format::iso($group->created_at),
            'is_owner' => $group->owner_id === $me,
            'invite_code' => Codes::format((string) $group->invite_code),
            'members' => $members,
            'members_count' => $members->count(),
            'unread' => $unread,
        ];

        if ($withBookings) {
            $data['bookings'] = Booking::with(['partner', 'offer', 'group', 'user'])
                ->withFeedbackGiven()
                ->where('group_id', $group->id)
                ->orderByDesc('id')
                ->limit(20)
                ->get()
                ->map(function (Booking $b) use ($request, $me) {
                    $row = (new BookingResource($b))->toArray($request) + ['booked_by' => $b->user?->name];
                    // Den Code sieht nur, wer gebucht hat - die Gruppe sieht, DASS gebucht ist.
                    if ($b->user_id !== $me) {
                        $row['code'] = null;
                    }

                    return $row;
                });
        }

        return $data;
    }
}
