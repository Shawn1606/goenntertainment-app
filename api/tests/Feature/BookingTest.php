<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\CreditLot;
use App\Models\CreditTransaction;
use App\Models\Offer;
use App\Models\Payment;
use App\Models\User;
use App\Support\Bookings;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

class BookingTest extends MarketplaceTestCase
{
    public function test_angebote_liste_zeigt_nur_aktive_bei_aktiven_partnern(): void
    {
        $this->actingAsUser();
        $active = $this->partner();
        $paused = $this->partner(['is_active' => false]);
        $this->offer($active, ['title' => 'Sichtbar']);
        $this->offer($active, ['title' => 'Aus', 'is_active' => false]);
        $this->offer($paused, ['title' => 'Partner pausiert']);

        $this->getJson('/api/offers')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', 'Sichtbar')
            ->assertJsonPath('data.0.partner.name', $active->name)
            ->assertJsonMissingPath('data.0.partner.checkin_token');
    }

    public function test_gold_zu_zweit_bezahlt_mit_rabatt(): void
    {
        $user = $this->actingAsUser(['club_plan' => 'gold']);
        $offer = $this->offer($this->partner());

        $this->postJson("/api/offers/{$offer->id}/quote", ['people' => 2, 'pay_method' => 'money'])
            ->assertOk()
            ->assertJsonPath('data.discount_percent', 8)
            ->assertJsonPath('data.total_cents', 5518);

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'confirmed')
            ->assertJsonPath('data.total_cents', 5518)
            ->assertJsonPath('data.plan_key', 'gold');

        $payment = Payment::where('user_id', $user->id)->sole();
        $this->assertSame('test', $payment->provider);
        $this->assertSame(5518, $payment->amount_cents);
    }

    public function test_mit_credits_nur_wenn_genug_da_und_storno_bringt_sie_zurueck(): void
    {
        $user = $this->actingAsUser();
        $offer = $this->offer($this->partner());

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('credits');

        // 500 + 100 Mengenbonus + 100 Erstkauf-Bonus.
        $this->postJson('/api/wallet/purchase', ['credits' => 500])->assertCreated()->assertJsonPath('data.balance', 700);

        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertCreated()
            ->assertJsonPath('data.total_credits', 450)
            ->assertJsonPath('credits_balance', 250)
            ->json('data');

        $this->postJson("/api/bookings/{$booking['id']}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('credits_balance', 700);

        $this->postJson("/api/bookings/{$booking['id']}/cancel")->assertStatus(422);
        $this->assertSame(700, $user->fresh()->credits_balance);
    }

    public function test_grenzen_des_angebots_gelten(): void
    {
        $this->actingAsUser();
        $offer = $this->offer($this->partner(), ['min_people' => 2, 'max_people' => 6, 'price_credits' => null]);

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])
            ->assertStatus(422)->assertJsonValidationErrors('people');
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 7, 'pay_method' => 'money'])
            ->assertStatus(422)->assertJsonValidationErrors('people');
        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'credits'])
            ->assertStatus(422)->assertJsonValidationErrors('pay_method');
    }

    public function test_fremde_buchungen_gibt_es_nicht(): void
    {
        $owner = $this->user();
        $offer = $this->offer($this->partner());
        $booking = Booking::create([
            'code' => 'ABCDEFGH', 'user_id' => $owner->id, 'offer_id' => $offer->id, 'partner_id' => $offer->partner_id,
            'offer_title' => 'x', 'partner_name' => 'y', 'people' => 1, 'plan_key' => 'free', 'pay_method' => 'money',
            'valid_until' => now()->addDay(),
        ]);

        $this->actingAsUser();
        $this->getJson("/api/bookings/{$booking->id}")->assertNotFound();
        $this->postJson("/api/bookings/{$booking->id}/cancel")->assertNotFound();
    }

    public function test_ohne_freigeschaltete_zahlung_wird_nichts_abgebucht(): void
    {
        config(['club.payments' => 'off']);
        $this->actingAsUser();
        $offer = $this->offer($this->partner());

        $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])->assertStatus(503);
        $this->postJson('/api/wallet/purchase', ['credits' => 100])->assertStatus(503);
        $this->assertSame(0, Booking::count());
    }

    /** Eine Credits-Buchung ueber die API; das Konto hat danach 250 Credits (700 - 450). */
    private function creditsBooking(Offer $offer): Booking
    {
        $this->postJson('/api/wallet/purchase', ['credits' => 500])->assertCreated();
        $id = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'credits'])
            ->assertCreated()
            ->json('data.id');

        return Booking::findOrFail($id);
    }

    private function refunds(Booking $booking): int
    {
        return CreditTransaction::where('booking_id', $booking->id)->where('kind', 'refund')->count();
    }

    /**
     * Zwei Stornos derselben Buchung - auch eines, das seine Buchung geladen hat, bevor das erste
     * fertig war (wie zwei Anfragen zugleich): nur eines erstattet.
     */
    public function test_zweites_storno_wird_abgelehnt_und_erstattet_nicht_noch_einmal(): void
    {
        $user = $this->actingAsUser();
        $booking = $this->creditsBooking($this->offer($this->partner()));
        $stale = Booking::findOrFail($booking->id);

        $this->postJson("/api/bookings/{$booking->id}/cancel")->assertOk()->assertJsonPath('credits_balance', 700);
        $this->postJson("/api/bookings/{$booking->id}/cancel")
            ->assertStatus(422)
            ->assertJsonPath('message', 'Diese Buchung ist schon storniert.');

        $this->expectValidation(fn () => Bookings::cancel($stale), 'Diese Buchung ist schon storniert.');

        $this->assertSame(700, $user->fresh()->credits_balance);
        $this->assertSame(1, $this->refunds($booking));
    }

    /** Eingeloest ist eingeloest: kein Storno danach, auch nicht mit dem Stand von vorher. */
    public function test_storno_nach_dem_einloesen_wird_abgelehnt(): void
    {
        $user = $this->actingAsUser();
        $partner = $this->partner();
        $booking = $this->creditsBooking($this->offer($partner));
        $stale = Booking::findOrFail($booking->id);

        $this->postJson("/api/bookings/{$booking->id}/redeem", ['token' => $partner->checkin_token])->assertOk();

        $this->postJson("/api/bookings/{$booking->id}/cancel")
            ->assertStatus(422)
            ->assertJsonPath('message', 'Diese Buchung ist schon eingelöst.');
        $this->expectValidation(fn () => Bookings::cancel($stale), 'Diese Buchung ist schon eingelöst.');

        $this->assertSame('redeemed', $booking->fresh()->status);
        $this->assertSame(250, $user->fresh()->credits_balance);
        $this->assertSame(0, $this->refunds($booking));
    }

    /** Storniert ist storniert: kein Einloesen danach, weder am Aufkleber noch mit altem Stand. */
    public function test_einloesen_nach_dem_storno_wird_abgelehnt(): void
    {
        $this->actingAsUser();
        $partner = $this->partner();
        $booking = $this->creditsBooking($this->offer($partner));
        $stale = Booking::findOrFail($booking->id);

        $this->postJson("/api/bookings/{$booking->id}/cancel")->assertOk();

        $this->postJson("/api/bookings/{$booking->id}/redeem", ['token' => $partner->checkin_token])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Diese Buchung ist storniert.');
        $this->expectValidation(fn () => Bookings::redeem($stale), 'Diese Buchung ist storniert.');

        $this->assertSame('cancelled', $booking->fresh()->status);
        $this->assertNull($booking->fresh()->redeemed_at);
    }

    /**
     * Abgelaufen heisst: Die Credits sind ausgegeben. Ein Storno danach oeffnete fuer laengst
     * verfallene Credits eine neue Frist - so verfielen sie nie.
     */
    public function test_abgelaufene_buchung_laesst_sich_nicht_stornieren(): void
    {
        $user = $this->actingAsUser();
        $booking = $this->creditsBooking($this->offer($this->partner(), ['valid_days' => 1]));
        $lots = CreditLot::where('user_id', $user->id)->count();

        $this->travelTo($booking->valid_until->copy()->addMinute());

        $this->postJson("/api/bookings/{$booking->id}/cancel")
            ->assertStatus(422)
            ->assertJsonPath('message', 'Diese Buchung ist abgelaufen und lässt sich nicht mehr stornieren.');

        $this->assertSame('confirmed', $booking->fresh()->status);
        $this->assertSame(0, $this->refunds($booking));
        $this->assertSame($lots, CreditLot::where('user_id', $user->id)->count(), 'a refund opened a new credit lot');
    }

    /**
     * Listen fragen die Rueckmeldung nicht je Buchung einzeln ab (N+1): Mit fuenf eingeloesten
     * Buchungen laufen so viele Abfragen wie mit zweien - in der eigenen Liste, beim Partner
     * (dort auch ohne den Kunden je Buchung nachzuladen) und im Admin-Bereich.
     */
    public function test_buchungslisten_fragen_nicht_je_buchung_nach(): void
    {
        $customer = $this->user(['name' => 'Lena Muster']);
        $partner = $this->partner();
        $offer = $this->offer($partner);
        $staff = $this->user();
        $partner->staff()->attach($staff->id, ['role' => 'staff', 'created_at' => now()]);
        $admin = $this->user();
        $admin->forceFill(['is_admin' => true])->save();

        // Ohne die Abfragen des Limiters (cache, cache_locks): Die erste Anfrage legt seine Zaehler an.
        $count = function (User $as, string $path): int {
            Sanctum::actingAs($as);
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson($path)->assertOk();
            DB::disableQueryLog();

            return collect(DB::getQueryLog())->reject(fn (array $q) => preg_match('/[`"]cache(_locks)?[`"]/', $q['query']) === 1)->count();
        };
        $redeemed = function (int $n) use ($customer, $offer) {
            for ($i = 0; $i < $n; $i++) {
                $booking = Bookings::create($customer, $offer, 1, 'money', null, null);
                Bookings::redeem($booking);
            }
        };

        $redeemed(2);
        $before = [
            $count($customer, '/api/bookings'),
            $count($staff, '/api/partner/bookings?partner_id='.$partner->id),
            $count($admin, '/api/admin/bookings'),
        ];
        $redeemed(3);
        $after = [
            $count($customer, '/api/bookings'),
            $count($staff, '/api/partner/bookings?partner_id='.$partner->id),
            $count($admin, '/api/admin/bookings'),
        ];

        $this->assertSame($before, $after);
        Sanctum::actingAs($customer);
        $this->getJson('/api/bookings')->assertJsonCount(5, 'data')->assertJsonPath('data.0.feedback_given', false);
    }

    private function expectValidation(callable $call, string $message): void
    {
        try {
            $call();
            $this->fail("no ValidationException ('{$message}')");
        } catch (ValidationException $e) {
            $this->assertSame($message, $e->validator->errors()->first());
        }
    }

    public function test_einloesen_am_aufkleber_braucht_den_richtigen_partner(): void
    {
        $this->actingAsUser();
        $partner = $this->partner();
        $other = $this->partner();
        $offer = $this->offer($partner);

        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])->json('data');

        $this->postJson("/api/bookings/{$booking['id']}/redeem", ['token' => $other->checkin_token])->assertStatus(422);
        $this->postJson("/api/bookings/{$booking['id']}/redeem", ['token' => 'https://goe4fun.de/c/'.$partner->checkin_token])
            ->assertOk()
            ->assertJsonPath('data.status', 'redeemed');
        $this->postJson("/api/bookings/{$booking['id']}/redeem", ['token' => $partner->checkin_token])->assertStatus(422);
    }
}
