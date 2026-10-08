<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Media;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Melden und Blockieren - portiert aus server/src/routes/reports.js und friends.js.
 *
 * Der Meldeweg ist die Gegenseite zum Haftungsausschluss in den Bedingungen:
 * Wer erklaert, fuer Inhalte nicht zu haften, muss einen Weg haben, von
 * Problemen zu erfahren. Meldungen landen im Admin-Bereich.
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

        try {
            DB::table('content_reports')->insert([
                'reporter_id' => $request->user()->getKey(),
                'target_type' => $data['target_type'],
                'target_id' => $data['target_id'],
                'reason' => $data['reason'],
                'note' => isset($data['note']) ? (trim($data['note']) ?: null) : null,
                'status' => 'open',
                'created_at' => now(),
            ]);
        } catch (UniqueConstraintViolationException) {
            // Schon gemeldet: kein Fehler - die Meldung liegt ja vor.
        }

        return response()->json(['message' => 'Danke! Wir schauen uns das an.'], 201);
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
