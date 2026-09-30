<?php

namespace App\Http\Controllers;

use App\Models\CreditTransaction;
use App\Support\Checkins;
use App\Support\Club;
use App\Support\ClubMembership;
use App\Support\Format;
use App\Support\Payments;
use App\Support\Vouchers;
use App\Support\Wallet;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Club, Credits und Stempelkarte eines Kontos.
 *
 * `GET /club` ist der eine Aufruf, den Startseite und Konto-Bereich brauchen:
 * Stufe, Credit-Stand, Stempelkarte, die Stufen zum Vergleichen und die Pakete.
 */
class ClubController extends Controller
{
    /** GET /api/club */
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->state($request)]);
    }

    /** POST /api/club/subscribe {plan} */
    public function subscribe(Request $request): JsonResponse
    {
        $data = $request->validate(['plan' => ['required', 'string']], ['plan.*' => 'Welche Stufe möchtest du?']);
        ClubMembership::subscribe($request->user(), $data['plan']);

        return response()->json(['data' => $this->state($request)]);
    }

    /** POST /api/club/cancel - zum Ende der Laufzeit. */
    public function cancel(Request $request): JsonResponse
    {
        ClubMembership::cancel($request->user());

        return response()->json(['data' => $this->state($request)]);
    }

    /** GET /api/wallet - Stand und die letzten Bewegungen. */
    public function wallet(Request $request): JsonResponse
    {
        $user = $request->user();
        $transactions = CreditTransaction::where('user_id', $user->getKey())
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn (CreditTransaction $t) => [
                'id' => $t->id,
                'amount' => $t->amount,
                'balance_after' => $t->balance_after,
                'kind' => $t->kind,
                'description' => $t->description,
                'created_at' => Format::iso($t->created_at),
            ]);

        return response()->json([
            'data' => [
                'balance' => (int) $user->credits_balance,
                'transactions' => $transactions,
                'packs' => $this->packs(),
                'payments_mode' => Payments::mode(),
            ],
        ]);
    }

    /** POST /api/wallet/purchase {credits} - ein Paket kaufen. */
    public function purchase(Request $request): JsonResponse
    {
        $data = $request->validate([
            'credits' => ['required', 'integer', Rule::in(Club::packs())],
        ], ['credits.*' => 'Dieses Paket gibt es nicht.']);

        $user = $request->user();
        $credits = (int) $data['credits'];
        $price = Club::packPriceCents($credits);

        $payment = Payments::charge($user, 'credits', $price, Format::credits($credits).' Credits');
        Wallet::credit($user, $credits, 'purchase', Format::credits($credits).' Credits gekauft ('.Format::euro($price).')', ['payment_id' => $payment->getKey()]);

        return response()->json(['data' => ['balance' => (int) $user->credits_balance, 'added' => $credits]], 201);
    }

    /** POST /api/wallet/redeem {code} - Gutscheincode einloesen. */
    public function redeem(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:40']], ['code.*' => 'Gib den Code von deiner Gutscheinkarte ein.']);

        $user = $request->user();
        $voucher = Vouchers::redeem($user, $data['code']);

        return response()->json(['data' => ['balance' => (int) $user->credits_balance, 'added' => $voucher->credits]], 201);
    }

    /** Alles, was die App fuer Club, Credits und Stempel braucht. */
    private function state(Request $request): array
    {
        $user = $request->user()->fresh();
        $plan = Club::plan($user->club_plan);

        return [
            'plan' => $plan['key'],
            'plan_name' => $plan['name'],
            'since' => Format::iso($user->club_since),
            'renews_at' => Format::iso($user->club_renews_at),
            'cancel_at_period_end' => (bool) $user->club_cancel_at_period_end,
            'credits' => (int) $user->credits_balance,
            'stamps' => Checkins::card($user),
            'plans' => Club::rules()['plans'],
            'group_discount' => Club::rules()['groupDiscount']['tiers'],
            'packs' => $this->packs(),
            'payments_mode' => Payments::mode(),
        ];
    }

    private function packs(): array
    {
        return array_map(fn (int $c) => ['credits' => $c, 'price_cents' => Club::packPriceCents($c)], Club::packs());
    }
}
