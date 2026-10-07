<?php

namespace App\Http\Controllers;

use App\Models\CreditLot;
use App\Models\CreditTransaction;
use App\Models\User;
use App\Support\Badges;
use App\Support\Checkins;
use App\Support\Club;
use App\Support\ClubMembership;
use App\Support\Format;
use App\Support\Payments;
use App\Support\Vouchers;
use App\Support\Wallet;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
        $data = $request->validate([
            'plan' => ['required', 'string'],
            'interval' => ['nullable', Rule::in(ClubMembership::INTERVALS)],
        ], ['plan.*' => 'Welche Stufe möchtest du?', 'interval.*' => 'Monatlich oder jährlich?']);
        ClubMembership::subscribe($request->user(), $data['plan'], $data['interval'] ?? 'month');

        return response()->json(['data' => $this->state($request)]);
    }

    /** GET /api/badges - Abzeichen mit Datum (verdiente zuerst). */
    public function badges(Request $request): JsonResponse
    {
        return response()->json(['data' => Badges::forUser($request->user())]);
    }

    /** POST /api/club/cancel - zum Ende der Laufzeit. */
    public function cancel(Request $request): JsonResponse
    {
        ClubMembership::cancel($request->user());

        return response()->json(['data' => $this->state($request)]);
    }

    /**
     * GET /api/wallet - Stand, was wann verfaellt, und die letzten Bewegungen.
     * Gutschriften tragen ihr Verfallsdatum mit (`expires_at`).
     */
    public function wallet(Request $request): JsonResponse
    {
        $user = $request->user();
        Wallet::expire($user);

        $rows = CreditTransaction::where('user_id', $user->getKey())
            ->orderByDesc('id')
            ->limit(50)
            ->get();
        $expires = CreditLot::whereIn('credit_transaction_id', $rows->where('amount', '>', 0)->pluck('id'))
            ->orderBy('id')
            ->get()
            ->keyBy('credit_transaction_id');
        $transactions = $rows->map(fn (CreditTransaction $t) => [
            'id' => $t->id,
            'amount' => $t->amount,
            'balance_after' => $t->balance_after,
            'kind' => $t->kind,
            'description' => $t->description,
            'created_at' => Format::iso($t->created_at),
            'expires_at' => Format::iso($expires->get($t->id)?->expires_at),
        ]);

        return response()->json([
            'data' => [
                'balance' => (int) $user->credits_balance,
                'lots' => Wallet::spendableLots($user),
                'validity_label' => Club::creditValidityLabel($user->club_plan),
                'first_purchase_bonus_percent' => $this->firstPurchaseBonusPercent($user),
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

        [$bonus, $firstBonus] = DB::transaction(function () use ($user, $credits) {
            // Konto sperren: Zwei gleichzeitige Erstkaeufe bekaemen sonst beide den Bonus.
            User::whereKey($user->getKey())->lockForUpdate()->value('id');

            $price = Club::packPriceCents($credits);
            $bonus = Club::packBonus($credits);
            $firstBonus = $this->isFirstPurchase($user) ? Club::firstPurchaseBonus($credits) : 0;
            $label = Format::credits($credits).' Credits'
                .($bonus > 0 ? ' + '.Format::credits($bonus).' Bonus' : '')
                .($firstBonus > 0 ? ' + '.Format::credits($firstBonus).' Erstkauf-Bonus' : '');

            // Eine Buchung fuer Paket UND Boni: Im Kontoauszug steht „200 Credits +
            // 50 Bonus gekauft" als eine Zeile, so wie es auf dem Knopf stand.
            $payment = Payments::charge($user, 'credits', $price, $label);
            Wallet::credit($user, $credits + $bonus + $firstBonus, 'purchase', $label.' gekauft', ['payment_id' => $payment->getKey()]);

            return [$bonus, $firstBonus];
        });

        return response()->json(['data' => [
            'balance' => (int) $user->credits_balance,
            'added' => $credits + $bonus + $firstBonus,
            'bonus' => $bonus,
            'first_purchase_bonus' => $firstBonus,
        ]], 201);
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
        Wallet::expire($request->user());
        $user = $request->user()->fresh();
        $plan = Club::plan($user->club_plan);
        $next = Wallet::spendableLots($user, 1)[0] ?? null;

        return [
            'plan' => $plan['key'],
            'plan_name' => $plan['name'],
            'since' => Format::iso($user->club_since),
            'renews_at' => Format::iso($user->club_renews_at),
            'cancel_at_period_end' => (bool) $user->club_cancel_at_period_end,
            'interval' => $user->club_interval ?? 'month',
            'credits' => (int) $user->credits_balance,
            'next_expiry' => $next,
            'credit_validity_label' => Club::creditValidityLabel($user->club_plan),
            'first_purchase_bonus_percent' => $this->firstPurchaseBonusPercent($user),
            'stamps' => Checkins::card($user),
            'plans' => Club::rules()['plans'],
            'group_discount' => Club::rules()['groupDiscount']['tiers'],
            'packs' => $this->packs(),
            'payments_mode' => Payments::mode(),
        ];
    }

    /** Hat das Konto noch nie ein Paket gekauft? Dann gibt es den Erstkauf-Bonus. */
    private function isFirstPurchase(User $user): bool
    {
        return ! CreditTransaction::where('user_id', $user->getKey())->where('kind', 'purchase')->exists();
    }

    /** Prozent Erstkauf-Bonus, die dieses Konto beim naechsten Kauf bekaeme (0 = verbraucht). */
    private function firstPurchaseBonusPercent(User $user): int
    {
        return $this->isFirstPurchase($user) ? (int) (Club::rules()['credits']['firstPurchaseBonusPercent'] ?? 0) : 0;
    }

    private function packs(): array
    {
        return array_map(fn (int $c) => ['credits' => $c, 'bonus' => Club::packBonus($c), 'price_cents' => Club::packPriceCents($c)], Club::packs());
    }
}
