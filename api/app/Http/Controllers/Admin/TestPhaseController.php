<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Offer;
use App\Models\TestphaseChallenge;
use App\Support\BusinessDay;
use App\Support\Club;
use App\Support\TestPhase\Board;
use App\Support\TestPhase\Community;
use App\Support\TestPhase\Examples;
use App\Support\TestPhase\Progress;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Der Admin-Bildschirm „Test": Ideen in der Testphase - Stadt-Bingo,
 * Challenges, Check-in-Serie. Gerechnet wird mit dem eigenen Konto des Admins;
 * Belohnungen sind echte Credits (App\Support\TestPhase\Board).
 */
class TestPhaseController extends Controller
{
    /** GET /api/admin/testphase */
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => Board::state($request->user())]);
    }

    /** POST /api/admin/testphase/claim {key} */
    public function claim(Request $request): JsonResponse
    {
        $data = $request->validate(['key' => ['required', 'string', 'max:60']]);
        $result = Board::claim($request->user(), $data['key']);

        return response()->json([
            'data' => $result['state'],
            'credits' => $result['credits'],
            'balance' => (int) $request->user()->fresh()->credits_balance,
        ]);
    }

    /** POST /api/admin/testphase/challenges */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(TestphaseChallenge::TYPES)],
            'title' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:300'],
            'metric' => ['required', Rule::in(Progress::METRICS)],
            'target' => ['required', 'integer', 'min:1', 'max:999'],
            'reward_credits' => ['required', 'integer', 'min:0', 'max:5000'],
            'period' => ['required', Rule::in(TestphaseChallenge::PERIODS)],
            'starts_at' => ['nullable', 'required_if:period,range', 'date'],
            'ends_at' => ['nullable', 'required_if:period,range', 'date', 'after_or_equal:starts_at'],
            'partner_id' => ['nullable', 'integer', 'exists:partners,id'],
            'interest_id' => ['nullable', 'integer', 'exists:interests,id'],
            'match_text' => ['nullable', 'string', 'max:60'],
            'offer_kind' => ['nullable', Rule::in(Offer::KINDS)],
            'plans' => ['nullable', 'array'],
            'plans.*' => [Rule::in(Club::planKeys())],
            'is_secret' => ['sometimes', 'boolean'],
            'is_choice' => ['sometimes', 'boolean'],
        ], [
            'title.required' => 'Gib der Challenge einen Titel.',
            'starts_at.required_if' => 'Ein fester Zeitraum braucht einen Start.',
            'ends_at.required_if' => 'Ein fester Zeitraum braucht ein Ende.',
            'ends_at.after_or_equal' => 'Das Ende liegt vor dem Start.',
        ]);

        if (empty($data['plans'])) {
            $data['plans'] = null;
        }
        $challenge = TestphaseChallenge::create($data + ['sort' => (int) TestphaseChallenge::max('sort') + 1]);

        return response()->json(['data' => Board::state($request->user()), 'id' => $challenge->id], 201);
    }

    /** DELETE /api/admin/testphase/challenges/{id} */
    public function destroy(Request $request, int $id): JsonResponse
    {
        TestphaseChallenge::whereKey($id)->delete();

        return response()->json(['data' => Board::state($request->user())]);
    }

    /** POST /api/admin/testphase/choose {challenge_id} - Challenge mit Wahl an- oder abwaehlen. */
    public function choose(Request $request): JsonResponse
    {
        $data = $request->validate(['challenge_id' => ['required', 'integer']]);
        Board::toggleChoice($request->user(), (int) $data['challenge_id']);

        return $this->state($request);
    }

    /** POST /api/admin/testphase/wishes {name, note?} - Partner vorschlagen. */
    public function storeWish(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:300'],
        ], ['name.required' => 'Welche Firma wünschst du dir?']);
        Community::addWish($request->user(), $data['name'], $data['note'] ?? null);

        return $this->state($request, 201);
    }

    /** POST /api/admin/testphase/wishes/{id}/vote - Stimme setzen oder zuruecknehmen. */
    public function voteWish(Request $request, int $id): JsonResponse
    {
        Community::vote($request->user(), $id);

        return $this->state($request);
    }

    /** DELETE /api/admin/testphase/wishes/{id} */
    public function destroyWish(Request $request, int $id): JsonResponse
    {
        \Illuminate\Support\Facades\DB::table('partner_wishes')->where('id', $id)->delete();

        return $this->state($request);
    }

    /** POST /api/admin/testphase/shares {booking_id, user_ids[]} - um Anteile bitten. */
    public function storeShares(Request $request): JsonResponse
    {
        $data = $request->validate([
            'booking_id' => ['required', 'integer'],
            'user_ids' => ['required', 'array', 'min:1'],
            'user_ids.*' => ['integer'],
        ], ['user_ids.*' => 'Wähle mindestens eine Person aus der Gruppe.']);
        Community::requestShares($request->user(), (int) $data['booking_id'], array_map('intval', $data['user_ids']));

        return $this->state($request, 201);
    }

    /** POST /api/admin/testphase/shares/{id}/pay - eigenen Anteil in Credits zahlen. */
    public function payShare(Request $request, int $id): JsonResponse
    {
        $credits = Community::payShare($request->user(), $id);

        return response()->json([
            'data' => Board::state($request->user()),
            'credits' => $credits,
            'balance' => (int) $request->user()->fresh()->credits_balance,
        ]);
    }

    /** POST /api/admin/testphase/shares/{id}/decline */
    public function declineShare(Request $request, int $id): JsonResponse
    {
        Community::declineShare($request->user(), $id);

        return $this->state($request);
    }

    /** POST /api/admin/testphase/polls {group_id, title, options: [{offer_id, day?}]} */
    public function storePoll(Request $request): JsonResponse
    {
        $data = $request->validate([
            'group_id' => ['required', 'integer'],
            'title' => ['nullable', 'string', 'max:120'],
            'options' => ['required', 'array', 'min:2', 'max:3'],
            'options.*.offer_id' => ['required', 'integer'],
            'options.*.day' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:'.BusinessDay::today()],
        ], [
            'options.*' => 'Wähle 2 oder 3 Angebote.',
            'options.*.day.*' => 'Der Tag liegt in der Vergangenheit.',
        ]);
        Community::createPoll($request->user(), (int) $data['group_id'], (string) ($data['title'] ?? ''), $data['options']);

        return $this->state($request, 201);
    }

    /** POST /api/admin/testphase/polls/{id}/vote {option_id} */
    public function votePoll(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['option_id' => ['required', 'integer']]);
        Community::votePoll($request->user(), $id, (int) $data['option_id']);

        return $this->state($request);
    }

    /** POST /api/admin/testphase/polls/{id}/close */
    public function closePoll(Request $request, int $id): JsonResponse
    {
        Community::closePoll($request->user(), $id);

        return $this->state($request);
    }

    private function state(Request $request, int $status = 200): JsonResponse
    {
        return response()->json(['data' => Board::state($request->user())], $status);
    }

    /** POST /api/admin/testphase/examples - Beispiel-Challenges anlegen. */
    public function examples(Request $request): JsonResponse
    {
        $created = Examples::create();

        return response()->json(['data' => Board::state($request->user()), 'created' => $created]);
    }
}
