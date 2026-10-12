<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\CreditTransaction;
use App\Models\Stamp;
use App\Models\User;
use App\Rules\NoBlockedTerms;
use App\Support\AccountDeletion;
use App\Support\Checkins;
use App\Support\Club;
use App\Support\Format;
use App\Support\Media;
use App\Support\Uploads;
use App\Support\Wallet;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Nutzer verwalten: umbenennen, Profilname und -bild zuruecksetzen, sperren
 * (dauerhaft oder auf Zeit, mit Beweisfoto), entsperren, loeschen - und Credits
 * sowie Stempel ansehen und korrigieren (Kulanz, Gewinnspiel, Fehlbuchung).
 *
 * Sperren, Umbenennen, Zuruecksetzen und Loeschen gehen nicht auf das EIGENE Konto - sonst
 * sperrt oder loescht sich ein Admin aus Versehen selbst aus. Credits und
 * Stempel dagegen schon: Das ist eine Korrektur, kein Rauswurf.
 */
class UserController extends Controller
{
    /** Was ein zurueckgesetzter Profilname wird, wenn das Konto keinen Benutzernamen hat. */
    public const NEUTRAL_NAME = 'Mitglied';

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
            ->addSelect([
                'bookings_count' => DB::table('bookings')->selectRaw('COUNT(*)')->whereColumn('bookings.user_id', 'users.id'),
                'stamps_total' => DB::table('stamps')->selectRaw('COUNT(*)')->whereColumn('stamps.user_id', 'users.id'),
            ])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(300)
            ->get();

        return response()->json(['data' => $users->map(fn (User $u) => $this->present($request, $u))]);
    }

    /** GET /api/admin/users/{id} - ein Konto mit Stempelkarte und letzten Credit-Bewegungen. */
    public function show(Request $request, int $id): JsonResponse
    {
        return response()->json(['data' => $this->detail($request, $this->find($id))]);
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

    /**
     * POST /api/admin/users/{id}/clear-profile {name?: bool, avatar?: bool} - einen anstoessigen
     * Profilnamen und/oder ein Profilbild zuruecksetzen. Der Name wird der Benutzername (den
     * aendert PATCH /admin/users/{id}), ohne Benutzernamen NEUTRAL_NAME - leer darf die Spalte
     * nicht sein. Das Profilbild wird entfernt und seine Datei geloescht.
     */
    public function clearProfile(Request $request, int $id): JsonResponse
    {
        $user = $this->target($request, $id);
        $data = $request->validate([
            'name' => ['sometimes', 'boolean'],
            'avatar' => ['sometimes', 'boolean'],
        ], ['name.*' => 'name: true oder false.', 'avatar.*' => 'avatar: true oder false.']);

        $clearName = (bool) ($data['name'] ?? false);
        $clearAvatar = (bool) ($data['avatar'] ?? false);
        if (! $clearName && ! $clearAvatar) {
            throw ValidationException::withMessages(['name' => ['Was soll zurückgesetzt werden? Name, Profilbild oder beides.']]);
        }

        $previousAvatar = $user->avatar;
        if ($clearName) {
            $user->forceFill(['name' => $user->username ?: self::NEUTRAL_NAME]);
        }
        if ($clearAvatar) {
            $user->forceFill(['avatar' => null]);
        }
        $user->save();

        // Die Datei erst nach dem Speichern: Scheitert das, zeigt das Konto nicht auf ein Loch.
        if ($clearAvatar) {
            Uploads::delete($previousAvatar);
        }

        return response()->json(['message' => 'Profil zurückgesetzt.', 'data' => $this->detail($request, $user->fresh())]);
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

    /** POST /api/admin/users/{id}/credits {amount, note} - Gutschrift (oder Korrektur mit Minus). Auch fuers eigene Konto. */
    public function credits(Request $request, int $id): JsonResponse
    {
        $user = $this->find($id);
        $data = $request->validate([
            'amount' => ['required', 'integer', 'between:-100000,100000', 'not_in:0'],
            'note' => ['required', 'string', 'min:3', 'max:150'],
        ], [
            'amount.*' => 'Wie viele Credits? (nicht 0)',
            'note.*' => 'Bitte einen Grund angeben – er steht im Kontoauszug der Person.',
        ]);

        $amount = (int) $data['amount'];
        if ($amount < 0 && -$amount > (int) $user->credits_balance) {
            throw ValidationException::withMessages(['amount' => [
                'Auf dem Konto sind nur '.Format::credits((int) $user->credits_balance).' Credits – mehr lässt sich nicht abziehen.',
            ]]);
        }
        $amount > 0
            ? Wallet::credit($user, $amount, 'admin', $data['note'])
            : Wallet::debit($user, -$amount, 'admin', $data['note']);

        return response()->json(['data' => $this->detail($request, $user->fresh())]);
    }

    /** POST /api/admin/users/{id}/stamps {amount} - Stempel gutschreiben (Plus) oder abziehen (Minus). Auch fuers eigene Konto. */
    public function stamps(Request $request, int $id): JsonResponse
    {
        $user = $this->find($id);
        $data = $request->validate([
            'amount' => ['required', 'integer', 'between:-100,100', 'not_in:0'],
        ], ['amount.*' => 'Wie viele Stempel? (–100 bis 100, nicht 0)']);

        $amount = (int) $data['amount'];
        $have = Stamp::where('user_id', $user->getKey())->count();
        if ($amount < 0 && -$amount > $have) {
            throw ValidationException::withMessages(['amount' => [
                "Das Konto hat nur {$have} Stempel – mehr lassen sich nicht abziehen.",
            ]]);
        }

        $result = Checkins::adjust($user, $amount);

        return response()->json([
            'data' => $this->detail($request, $user->fresh()),
            'reward_credits' => $result['reward_credits'],
        ]);
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

    /** Ein fremdes Konto - fuer Aktionen, die man nicht auf sich selbst anwenden darf. */
    private function target(Request $request, int $id): User
    {
        abort_if($id === $request->user()->getKey(), 400, 'Diese Aktion kannst du nicht auf dein eigenes Konto anwenden.');

        return $this->find($id);
    }

    private function find(int $id): User
    {
        $user = User::find($id);
        abort_if($user === null, 404, 'Nutzer nicht gefunden.');

        return $user;
    }

    /** Wie in der Liste, dazu Stempelkarte und die letzten Credit-Bewegungen. */
    private function detail(Request $request, User $u): array
    {
        $u->loadCount('groups');
        $u->bookings_count = DB::table('bookings')->where('user_id', $u->id)->count();
        $u->stamps_total = Stamp::where('user_id', $u->id)->count();

        $transactions = CreditTransaction::where('user_id', $u->id)->orderByDesc('id')->limit(15)->get()
            ->map(fn (CreditTransaction $t) => [
                'id' => $t->id,
                'amount' => $t->amount,
                'balance_after' => $t->balance_after,
                'kind' => $t->kind,
                'description' => $t->description,
                'created_at' => Format::iso($t->created_at),
            ]);

        return $this->present($request, $u) + [
            'is_self' => $u->id === $request->user()->getKey(),
            'stamps' => Checkins::card($u),
            'transactions' => $transactions,
        ];
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
        $message = 'Der Beweis muss ein Bild sein (jpeg, png, webp).';
        $request->validate(['evidence' => Uploads::rule()], ['evidence.*' => $message]);

        return Uploads::store($request->file('evidence'), 'evidence', 'evidence', $message);
    }

    /**
     * GET /api/admin/evidence-files/{file} - an evidence image, for admins only.
     *
     * Evidence lies on the private disk (App\Support\Uploads), never under the public /storage;
     * this route is the only way to it. The app loads it with the admin's bearer token. Like every
     * stored file: the type as sent and nothing guessed (nosniff), a file opened on its own may run
     * nothing (the CSP), and no cache on the way or on the device keeps it.
     */
    public function evidenceFile(string $file): Response
    {
        $path = 'evidence/'.$file;
        abort_unless(Uploads::isStored($path), 404, 'Nicht gefunden.');
        $disk = Storage::disk(Uploads::PRIVATE_DISK);
        abort_unless($disk->exists($path), 404, 'Nicht gefunden.');

        return response((string) $disk->get($path), 200, [
            'Content-Type' => Uploads::mimeFor($file),
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
            'Cache-Control' => 'private, no-store',
        ]);
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
            'stamps_total' => (int) ($u->stamps_total ?? 0),
            'banned' => $banned,
            'banned_permanent' => $banned && $info['permanent'],
            'banned_until' => $banned ? $info['banned_until'] : null,
            'ban_reason' => $banned ? $info['reason'] : null,
        ];
    }
}
