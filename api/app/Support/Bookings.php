<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\Group;
use App\Models\Offer;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Buchen, stornieren, einloesen.
 *
 * ## Der Preis entsteht hier
 *
 * Die App rechnet mit denselben Regeln eine Vorschau (src/domain/club.ts). Beim
 * Buchen zaehlt aber nur, was hier herauskommt - mit der Stufe, die das Konto
 * JETZT hat, und dem Deckel, den das Angebot JETZT setzt. Beides steht danach in
 * der Buchung und aendert sich nicht mehr.
 *
 * ## Zwei Arten zu bezahlen
 *
 *  - `money`: Euro ueber App\Support\Payments (vorerst Testmodus).
 *  - `credits`: vom Credit-Konto (App\Support\Wallet).
 *
 * Derselbe Rabatt gilt fuer beide.
 */
final class Bookings
{
    public const PAY_METHODS = ['money', 'credits'];

    /** Hoechstens so viele Personen in einer Buchung, wenn das Angebot nichts sagt. */
    public const MAX_PEOPLE = 50;

    /**
     * Was eine Buchung kosten wuerde - ohne sie anzulegen.
     *
     * @return array<string, mixed>
     */
    public static function quote(User $user, Offer $offer, int $people, string $payMethod): array
    {
        self::assertBookable($offer, $people, $payMethod);
        $cap = $offer->effectiveMaxDiscount();

        if ($payMethod === 'credits') {
            $q = Club::quoteCredits($user->club_plan, $people, (int) $offer->price_credits, $cap);

            return [
                'pay_method' => 'credits',
                'people' => $q['people'],
                'plan' => Club::plan($user->club_plan)['key'],
                'club_percent' => $q['clubPercent'],
                'group_percent' => $q['groupPercent'],
                'discount_percent' => $q['percent'],
                'capped' => $q['capped'],
                'unit_credits' => $q['unitCredits'],
                'subtotal_credits' => $q['subtotalCredits'],
                'total_credits' => $q['totalCredits'],
                'balance' => (int) $user->credits_balance,
            ];
        }

        $q = Club::quoteMoney($user->club_plan, $people, (int) $offer->price_cents, $cap);

        return [
            'pay_method' => 'money',
            'people' => $q['people'],
            'plan' => Club::plan($user->club_plan)['key'],
            'club_percent' => $q['clubPercent'],
            'group_percent' => $q['groupPercent'],
            'discount_percent' => $q['percent'],
            'capped' => $q['capped'],
            'unit_price_cents' => $q['unitPriceCents'],
            'subtotal_cents' => $q['subtotalCents'],
            'discount_cents' => $q['discountCents'],
            'total_cents' => $q['totalCents'],
        ];
    }

    public static function create(User $user, Offer $offer, int $people, string $payMethod, ?Group $group, ?string $preferredDate): Booking
    {
        if ($group !== null && ! $group->hasMember($user->getKey())) {
            throw ValidationException::withMessages(['group_id' => ['Du bist nicht in dieser Gruppe.']]);
        }

        $quote = self::quote($user, $offer, $people, $payMethod);
        $partner = $offer->partner;

        return DB::transaction(function () use ($user, $offer, $partner, $group, $preferredDate, $quote, $payMethod) {
            $payment = null;
            if ($payMethod === 'money' && $quote['total_cents'] > 0) {
                $payment = Payments::charge(
                    $user,
                    'booking',
                    $quote['total_cents'],
                    "{$offer->title} bei {$partner->name} ({$quote['people']} P.)",
                );
            }

            $booking = Booking::create([
                'code' => Codes::unique(8, fn (string $c) => Booking::where('code', $c)->exists()),
                'user_id' => $user->getKey(),
                'offer_id' => $offer->getKey(),
                'partner_id' => $partner->getKey(),
                'group_id' => $group?->getKey(),
                'offer_title' => $offer->title,
                'partner_name' => $partner->name,
                'people' => $quote['people'],
                'plan_key' => $quote['plan'],
                'pay_method' => $payMethod,
                'unit_price_cents' => $quote['unit_price_cents'] ?? null,
                'unit_credits' => $quote['unit_credits'] ?? null,
                'discount_percent' => $quote['discount_percent'],
                'subtotal_cents' => $quote['subtotal_cents'] ?? 0,
                'discount_cents' => $quote['discount_cents'] ?? 0,
                'total_cents' => $quote['total_cents'] ?? 0,
                'subtotal_credits' => $quote['subtotal_credits'] ?? 0,
                'total_credits' => $quote['total_credits'] ?? 0,
                'status' => 'confirmed',
                'preferred_date' => $preferredDate,
                'valid_until' => now()->addDays(max(1, (int) $offer->valid_days))->endOfDay(),
                'payment_id' => $payment?->getKey(),
            ]);

            if ($payMethod === 'credits' && $quote['total_credits'] > 0) {
                Wallet::debit(
                    $user,
                    $quote['total_credits'],
                    'booking',
                    "{$offer->title} bei {$partner->name}",
                    ['booking_id' => $booking->getKey()],
                );
            }

            return $booking;
        });
    }

    /**
     * Stornieren, solange nicht eingeloest. Credits kommen zurueck aufs Konto,
     * Euro werden erstattet (im Testmodus nur vermerkt).
     */
    public static function cancel(Booking $booking): Booking
    {
        if ($booking->status !== 'confirmed') {
            throw ValidationException::withMessages([
                'booking' => [$booking->status === 'redeemed'
                    ? 'Diese Buchung ist schon eingelöst.'
                    : 'Diese Buchung ist schon storniert.'],
            ]);
        }

        return DB::transaction(function () use ($booking) {
            $booking->update(['status' => 'cancelled', 'cancelled_at' => now()]);

            if ($booking->pay_method === 'credits' && $booking->total_credits > 0 && $booking->user) {
                Wallet::credit(
                    $booking->user,
                    $booking->total_credits,
                    'refund',
                    "Storno: {$booking->offer_title}",
                    ['booking_id' => $booking->getKey()],
                );
            }

            if ($booking->payment_id !== null) {
                $payment = Payment::find($booking->payment_id);
                if ($payment) {
                    Payments::refund($payment);
                }
            }

            return $booking->refresh();
        });
    }

    /** Einloesen - vom Kunden am Aufkleber oder vom Partner nach dem Pass-Scan. */
    public static function redeem(Booking $booking, ?User $by = null): Booking
    {
        if (! $booking->isOpen()) {
            throw ValidationException::withMessages([
                'booking' => [match ($booking->displayStatus()) {
                    'redeemed' => 'Diese Buchung ist schon eingelöst.',
                    'cancelled' => 'Diese Buchung ist storniert.',
                    default => 'Diese Buchung ist abgelaufen.',
                }],
            ]);
        }

        $booking->update(['status' => 'redeemed', 'redeemed_at' => now(), 'redeemed_by' => $by?->getKey()]);

        return $booking;
    }

    private static function assertBookable(Offer $offer, int $people, string $payMethod): void
    {
        if (! $offer->is_active || ! $offer->partner?->is_active) {
            throw ValidationException::withMessages(['offer' => ['Dieses Angebot gibt es gerade nicht.']]);
        }

        if (! in_array($payMethod, self::PAY_METHODS, true)) {
            throw ValidationException::withMessages(['pay_method' => ['Unbekannte Zahlart.']]);
        }
        if ($payMethod === 'money' && $offer->price_cents === null) {
            throw ValidationException::withMessages(['pay_method' => ['Dieses Angebot gibt es nur gegen Credits.']]);
        }
        if ($payMethod === 'credits' && $offer->price_credits === null) {
            throw ValidationException::withMessages(['pay_method' => ['Dieses Angebot lässt sich nicht mit Credits bezahlen.']]);
        }

        $max = $offer->max_people ?? self::MAX_PEOPLE;
        if ($people < $offer->min_people) {
            throw ValidationException::withMessages(['people' => ["Dieses Angebot gibt es ab {$offer->min_people} Personen."]]);
        }
        if ($people > $max) {
            throw ValidationException::withMessages(['people' => ["Höchstens {$max} Personen pro Buchung."]]);
        }
    }
}
