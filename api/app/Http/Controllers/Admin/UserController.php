<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Rules\NoBlockedTerms;
use App\Support\AccountDeletion;
use App\Support\Club;
use App\Support\Format;
use App\Support\Media;
use App\Support\Uploads;
use App\Support\Wallet;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Nutzer verwalten - portiert aus server/src/routes/admin.js: umbenennen,
 * sperren (dauerhaft oder auf Zeit, mit Beweisfoto), entsperren, loeschen.
 * Neu: Credits gutschreiben (Kulanz, Gewinnspiel) und Club-Stand sehen.
 *
 * Keine dieser Aktionen geht auf das EIGENE Konto - sonst sperrt oder loescht
 * sich ein Admin aus Versehen selbst aus.
 */
class UserController extends Controller
{
    /** GET /api/admin/users?q= */
    public function index(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));

        $users = User::query()
            ->when($q !== '', fn ($query) => $query->where(fn ($w) => $w
                ->where('name', 'like', "%{$q}%")
                ->orWhere('username', 'like', "%{$q}%")
                ->orWhere('email', 'like', "%{$q}%")))
            ->withCount('groups')
            ->addSelect(['bookings_count' => DB::table('bookings')->selectRaw('COUNT(*)')->whereColumn('bookings.user_id', 'users.id')])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(300)
            ->get();

        return response()->json(['data' => $users->map(fn (User $u) => $this->present($request, $u))]);
    }

    /** PATCH /api/admin/users/{id} {username} */
    public function rename(Request $request, int $id): JsonResponse
    {
        $user = $this->target($request, $id);
        $data = $request->validate([
            'username' => ['bail', 'required', 'string', 'min:3', 'max:30', 'regex:/^[\w-]+$/', new NoBlockedTerms('username')],
        ], ['username.*' => 'Der Benutzername ist ungültig (3–30 Zeichen, nur Buchstaben/Zahlen/-_).']);

        if (User::where('username', $data['username'])->whereKeyNot($user->id)->exists()) {
            throw ValidationException::withMessages(['username' => ['Dieser Benutzername ist bereits vergeben.']]);
        }
        $user->forceFill(['username' => $data['username']])->save();

        return response()->json(['message' => 'Benutzername geändert.', 'username' => $user->username]);
    }

    /** POST /api/admin/users/{id}/ban {reason, evidence?} */
    public function ban(Request $request, int $id): JsonResponse
    {
        $user = $this->target($request, $id);
        $reason = $this->reason($request);
        $image = $this->storeEvidence($request);

        $user->forceFill(['banned_until' => User::PERMANENT_BAN_UNTIL, 'ban_reason' => $reason])->save();
        $user->tokens()->delete();
        $this->recordEvidence($request, $user, 'ban', $reason, null, $image);

        return response()->json(['message' => 'Nutzer gebannt.']);
    }

    /** POST /api/admin/users/{id}/timeout {minutes, reason, evidence?} */
    public function timeout(Request $request, int $id): JsonResponse
    {
        $user = $this->target($request, $id);
        $reason = $this->reason($request);
        $minutes = (int) $request->input('minutes');
        if ($minutes < 1 || $minutes > 60 * 24 * 365) {
            throw ValidationException::withMessages(['minutes' => ['Ungültige Timeout-Dauer (1 Minute bis 1 Jahr).']]);
        }
        $image = $this->storeEvidence($request);
        $until = now()->addMinutes($minutes);

        $user->forceFill(['banned_until' => $until, 'ban_reason' => $reason])->save();
        $user->tokens()->delete();
        $this->recordEvidence($request, $user, 'timeout', $reason, $until, $image);

        return response()->json(['message' => 'Timeout gesetzt.', 'banned_until' => Format::iso($until)]);
    }

    /** POST /api/admin/users/{id}/unban */
    public function unban(Request $request, int $id): JsonResponse
    {
        $this->target($request, $id)->forceFill(['banned_until' => null, 'ban_reason' => null])->save();

        return response()->json(['message' => 'Sperre aufgehoben.']);
    }

    /** DELETE /api/admin/users/{id} */
    public function destroy(Request $request, int $id): JsonResponse
    {
        AccountDeletion::delete($this->target($request, $id));

        return response()->json(['message' => 'Nutzer gelöscht.']);
    }

    /** POST /api/admin/users/{id}/credits {amount, note} - Gutschrift (oder Korrektur mit Minus). */
    public function credits(Request $request, int $id): JsonResponse
    {
        $user = $this->target($request, $id);
        $data = $request->validate([
            'amount' => ['required', 'integer', 'between:-100000,100000', 'not_in:0'],
            'note' => ['required', 'string', 'min:3', 'max:150'],
        ], [
            'amount.*' => 'Wie viele Credits? (nicht 0)',
            'note.*' => 'Bitte einen Grund angeben – er steht im Kontoauszug der Person.',
        ]);

        $amount = (int) $data['amount'];
        $amount > 0
            ? Wallet::credit($user, $amount, 'admin', $data['note'])
            : Wallet::debit($user, -$amount, 'admin', $data['note']);

        return response()->json(['data' => $this->present($request, $user->fresh())]);
    }

    /** GET /api/admin/evidence */
    public function evidence(Request $request): JsonResponse
    {
        $rows = DB::table('ban_evidence as e')
            ->join('users as u', 'u.id', '=', 'e.user_id')
            ->leftJoin('users as a', 'a.id', '=', 'e.admin_id')
            ->orderByDesc('e.created_at')
            ->orderByDesc('e.id')
            ->limit(300)
            ->get(['e.id', 'e.action', 'e.reason', 'e.banned_until', 'e.image_path', 'e.created_at', 'e.source',
                'u.id as user_id', 'u.name as user_name', 'u.username as user_username', 'a.name as admin_name']);

        return response()->json([
            'data' => $rows->map(fn ($r) => [
                'id' => $r->id,
                'action' => $r->action,
                'reason' => $r->reason,
                'banned_until' => $r->banned_until,
                'image_url' => Media::url($r->image_path, $request),
                'created_at' => $r->created_at,
                'user' => ['id' => $r->user_id, 'name' => $r->user_name, 'username' => $r->user_username],
                'admin_name' => $r->admin_name,
                'source' => $r->source === 'ai' ? 'ai' : 'admin',
            ]),
        ]);
    }

    private function target(Request $request, int $id): User
    {
        abort_if($id === $request->user()->getKey(), 400, 'Diese Aktion kannst du nicht auf dein eigenes Konto anwenden.');
        $user = User::find($id);
        abort_if($user === null, 404, 'Nutzer nicht gefunden.');

        return $user;
    }

    private function reason(Request $request): string
    {
        $reason = trim((string) $request->input('reason'));
        if (mb_strlen($reason) < 3 || mb_strlen($reason) > 255) {
            throw ValidationException::withMessages(['reason' => ['Bitte einen Grund angeben (3–255 Zeichen).']]);
        }

        return $reason;
    }

    private function storeEvidence(Request $request): ?string
    {
        if (! $request->hasFile('evidence')) {
            return null;
        }
        $request->validate(['evidence' => Uploads::rule()], ['evidence.*' => 'Der Beweis muss ein Bild sein (jpeg, png, webp).']);

        return Uploads::store($request->file('evidence'), 'evidence');
    }

    private function recordEvidence(Request $request, User $user, string $action, string $reason, $until, ?string $image): void
    {
        DB::table('ban_evidence')->insert([
            'user_id' => $user->id,
            'admin_id' => $request->user()->getKey(),
            'source' => 'admin',
            'action' => $action,
            'reason' => $reason,
            'banned_until' => $until,
            'image_path' => $image,
            'created_at' => now(),
        ]);
    }

    private function present(Request $request, User $u): array
    {
        $banned = $u->isBanned();
        $info = $u->banInfo();

        return [
            'id' => $u->id,
            'name' => $u->name,
            'username' => $u->username,
            'email' => $u->email,
            'is_admin' => (bool) $u->is_admin,
            'avatar' => Media::url($u->avatar, $request),
            'created_at' => Format::iso($u->created_at),
            'club_plan' => Club::plan($u->club_plan)['key'],
            'credits_balance' => (int) $u->credits_balance,
            'groups_count' => (int) ($u->groups_count ?? 0),
            'bookings_count' => (int) ($u->bookings_count ?? 0),
            'banned' => $banned,
            'banned_permanent' => $banned && $info['permanent'],
            'banned_until' => $banned ? $info['banned_until'] : null,
            'ban_reason' => $banned ? $info['reason'] : null,
        ];
    }
}
