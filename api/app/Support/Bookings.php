<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\CreditTransaction;
use App\Models\Group;
use App\Models\Offer;
use App\Models\Payment;
use App\Models\User;
use App\Support\TestPhase\TestPhase;
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
    public static function quote(User $user, Offer $offer, int $people, string $payMethod, ?string $preferredDate = null): array
    {
        self::assertBookable($offer, $people, $payMethod);
        $cap = $offer->effectiveMaxDiscount();

        if ($payMethod === 'credits') {
            $q = Club::quoteCredits($user->club_plan, $people, (int) $offer->price_credits, $cap);

            // Testphase: Happy Hour - an ruhigen Wochentagen weniger Credits fuer
            // Club-Mitglieder, zusaetzlich zum Rabatt (shared/club.json).
            $happy = TestPhase::enabledFor($user) ? Club::happyHourPercent($user->club_plan, $preferredDate) : 0.0;
            if ($happy > 0) {
                $q['totalCredits'] = (int) ceil($q['totalCredits'] * (100 - $happy) / 100 - 1e-9);
            }

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
                'happy_hour_percent' => $happy,
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

        $quote = self::quote($user, $offer, $people, $payMethod, $preferredDate);
        $partner = $offer->partner;

        return DB::transaction(function () use ($user, $offer, $partner, $group, $preferredDate, $quote, $payMethod, $people) {
            // Kontingent pruefen, waehrend das Angebot gesperrt ist: Zwei Buchungen
            // gleichzeitig koennen sonst beide den letzten Platz bekommen.
            if ($offer->daily_capacity !== null) {
                Offer::whereKey($offer->getKey())->lockForUpdate()->value('id');
                self::assertCapacity($user, $offer, $people, $preferredDate);
            }

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
                // Bis Ende des Tages in Ortszeit - die App zeigt das deutsche Datum (BusinessDay).
                'valid_until' => BusinessDay::endOfDayIn(max(1, (int) $offer->valid_days)),
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
     * Stornieren, solange nicht eingeloest und nicht abgelaufen. Credits kommen
     * zurueck aufs Konto, Euro werden erstattet (im Testmodus nur vermerkt).
     *
     * ## Genau eine Erstattung
     *
     * Der Zustand wird unter der Sperre der Zeile NEU gelesen - nicht der, den
     * der Controller vorher geladen hat. Sonst sahen ein Storno und ein Einloesen
     * (oder zwei Stornos) gleichzeitig beide `confirmed`: Die eingeloeste Buchung
     * kam erstattet zurueck, oder dieselbe Buchung zweimal. Erstattet wird nur
     * beim Wechsel confirmed -> cancelled, und den gibt es je Buchung einmal.
     *
     * Abgelaufene Buchungen lassen sich nicht mehr stornieren: Die Erstattung
     * oeffnete fuer laengst verfallene Credits eine neue Frist (Wallet::refund) -
     * wer kurz vor dem Verfall bucht und spaeter storniert, behielte seine
     * Credits sonst fuer immer.
     */
    public static function cancel(Booking $booking): Booking
    {
        return DB::transaction(function () use ($booking) {
            self::lockAndReload($booking);

            if ($booking->status !== 'confirmed') {
                throw ValidationException::withMessages([
                    'booking' => [$booking->status === 'redeemed'
                        ? 'Diese Buchung ist schon eingelöst.'
                        : 'Diese Buchung ist schon storniert.'],
                ]);
            }
            if (! $booking->isOpen()) {
                throw ValidationException::withMessages([
                    'booking' => ['Diese Buchung ist abgelaufen und lässt sich nicht mehr stornieren.'],
                ]);
            }

            // Nur der Wechsel aus `confirmed` erstattet - die Bedingung steht im UPDATE selbst.
            $changed = Booking::whereKey($booking->getKey())
                ->where('status', 'confirmed')
                ->update(['status' => 'cancelled', 'cancelled_at' => now()]);
            if ($changed !== 1) {
                throw ValidationException::withMessages(['booking' => ['Diese Buchung ist schon storniert.']]);
            }

            if ($booking->pay_method === 'credits' && $booking->total_credits > 0 && $booking->user) {
                // Zurueck auf die Posten, aus denen bezahlt wurde - mit ihrer alten
                // Frist. Sonst verlaengerte Buchen-und-Stornieren jeden Verfall.
                $debit = CreditTransaction::where('booking_id', $booking->getKey())
                    ->where('kind', 'booking')
                    ->where('amount', '<', 0)
                    ->latest('id')
                    ->first();
                $description = "Storno: {$booking->offer_title}";
                $refs = ['booking_id' => $booking->getKey()];

                $debit !== null
                    ? Wallet::refund($booking->user, $debit, $booking->total_credits, $description, $refs)
                    : Wallet::credit($booking->user, $booking->total_credits, 'refund', $description, $refs);
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

    /**
     * Einloesen - vom Kunden am Aufkleber oder vom Partner nach dem Pass-Scan.
     * Wie beim Storno zaehlt der Zustand unter der Sperre der Zeile, nicht der
     * vorher geladene: Eine Buchung, die gerade storniert wird, wird nicht
     * zugleich eingeloest.
     */
    public static function redeem(Booking $booking, ?User $by = null): Booking
    {
        return DB::transaction(function () use ($booking, $by) {
            self::lockAndReload($booking);

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
        });
    }

    /**
     * Im laufenden DB-Vorgang: Die Zeile der Buchung sperren und ihren Stand in
     * `$booking` uebernehmen. Geladene Beziehungen (Partner, Angebot) bleiben.
     */
    private static function lockAndReload(Booking $booking): void
    {
        $locked = Booking::whereKey($booking->getKey())->lockForUpdate()->first();
        abort_if($locked === null, 404, 'Diese Buchung gibt es nicht.');

        $booking->setRawAttributes($locked->getAttributes(), true);
    }

    /**
     * Tageskontingent eines Angebots (Testphase): Plaetze an einem Tag, davon
     * `platinum_reserved` nur fuer Platinum. Ohne Kontingent = unbegrenzt.
     *
     * @return array{capacity: int|null, booked: int, reserved: int, available: int|null, available_for_you: int|null}
     */
    public static function availability(Offer $offer, User $user, string $day): array
    {
        if ($offer->daily_capacity === null) {
            return ['capacity' => null, 'booked' => 0, 'reserved' => 0, 'available' => null, 'available_for_you' => null];
        }

        $booked = (int) Booking::where('offer_id', $offer->getKey())
            ->whereDate('preferred_date', $day)
            ->where('status', '!=', 'cancelled')
            ->sum('people');
        $capacity = (int) $offer->daily_capacity;
        $reserved = min((int) $offer->platinum_reserved, $capacity);
        $available = max(0, $capacity - $booked);
        $platinum = Club::plan($user->club_plan)['key'] === 'platinum';

        return [
            'capacity' => $capacity,
            'booked' => $booked,
            'reserved' => $reserved,
            'available' => $available,
            'available_for_you' => $platinum ? $available : max(0, $available - $reserved),
        ];
    }

    private static function assertCapacity(User $user, Offer $offer, int $people, ?string $day): void
    {
        if ($day === null) {
            throw ValidationException::withMessages(['preferred_date' => ['Wähle einen Tag – dieses Angebot hat begrenzte Plätze.']]);
        }

        $a = self::availability($offer, $user, $day);
        $label = \Illuminate\Support\Carbon::parse($day)->format('d.m.');
        if ($people > $a['available']) {
            throw ValidationException::withMessages(['people' => [
                $a['available'] === 0 ? "Am {$label} ist alles ausgebucht." : "Am {$label} sind nur noch {$a['available']} Plätze frei.",
            ]]);
        }
        if ($people > $a['available_for_you']) {
            throw ValidationException::withMessages(['people' => [
                "Die letzten {$a['reserved']} Plätze am {$label} sind für Platinum-Mitglieder reserviert.",
            ]]);
        }
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
