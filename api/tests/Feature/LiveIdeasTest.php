<?php

namespace Tests\Feature;

use App\Mail\CreditsExpiringSoon;
use App\Models\Booking;
use App\Models\CreditLot;
use App\Support\Checkins;
use App\Support\ClubMembership;
use App\Support\CreditReminders;
use App\Support\Pass;
use App\Support\Wallet;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;

/**
 * Live-Punkte aus der Ideen-Liste: Abzeichen (14), Verfall-Erinnerung (17),
 * Kalender-Export (79), Offline-Pass (85), barrierefreie Angaben (86),
 * Jahresabo (87).
 */
class LiveIdeasTest extends MarketplaceTestCase
{
    public function test_abzeichen_mit_datum_und_fortschritt(): void
    {
        Carbon::setTestNow('2026-10-06 12:00:00');
        $user = $this->actingAsUser();
        $partner = $this->partner();

        $badges = collect($this->getJson('/api/badges')->assertOk()->json('data'));
        $this->assertFalse($badges->firstWhere('key', 'first_visit')['earned']);
        $this->assertSame(['current' => 0, 'target' => 10], $badges->firstWhere('key', 'full_card')['progress']);

        $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])->assertCreated();
        Checkins::adjust($user, 9);

        $badges = collect($this->getJson('/api/badges')->json('data'));
        $first = $badges->firstWhere('key', 'first_visit');
        $this->assertTrue($first['earned']);
        $this->assertStringStartsWith('2026-10-06', $first['earned_at']);
        $this->assertTrue($badges->firstWhere('key', 'full_card')['earned']);
        // Verdiente stehen vorn.
        $this->assertTrue($badges->first()['earned']);
        // Testphase-Abzeichen nur fuer Admins.
        $this->assertNull($badges->firstWhere('key', 'challenge'));
    }

    public function test_verfall_erinnerung_30_und_7_tage_vorher_je_einmal(): void
    {
        Mail::fake();
        $user = $this->user(['email' => 'anna@example.org', 'name' => 'Anna Beispiel']);
        $this->offer($this->partner(), ['title' => 'Kaffee', 'price_credits' => 50]);
        Wallet::credit($user, 120, 'admin', 'Test');

        $this->travel(340)->days();
        $this->assertSame(1, CreditReminders::sendDue());
        $this->assertSame(0, CreditReminders::sendDue());
        Mail::assertSent(CreditsExpiringSoon::class, fn ($m) => $m->credits === 120 && $m->offers[0]['title'] === 'Kaffee' && $m->firstName === 'Anna');

        $this->travel(20)->days();
        $this->assertSame(1, CreditReminders::sendDue());
        $this->assertSame(0, CreditReminders::sendDue());
        Mail::assertSentCount(2);
        $this->assertNotNull(CreditLot::sole()->reminded_7_at);
    }

    public function test_kalender_datei_nur_mit_signatur(): void
    {
        $this->actingAsUser();
        $offer = $this->offer($this->partner(['name' => 'Bowling Süd', 'address' => 'Hauptstr. 1', 'city' => 'Göttingen']), ['title' => 'Bahn, 1 Stunde']);
        $booking = $this->postJson('/api/bookings', [
            'offer_id' => $offer->id, 'people' => 2, 'pay_method' => 'money', 'preferred_date' => now()->addDays(3)->toDateString(),
        ])->assertCreated()->json('data');

        $path = $booking['calendar_path'];
        $this->assertStringContainsString('/calendar.ics?sig=', $path);

        $ics = $this->get('/api'.$path)->assertOk()->assertHeader('Content-Type', 'text/calendar; charset=utf-8')->getContent();
        $this->assertStringContainsString('BEGIN:VEVENT', $ics);
        $this->assertStringContainsString('SUMMARY:Bahn\\, 1 Stunde bei Bowling Süd', $ics);
        $this->assertStringContainsString('DTSTART;VALUE=DATE:'.now()->addDays(3)->format('Ymd'), $ics);
        $this->assertStringContainsString('LOCATION:Hauptstr. 1\\, Göttingen', $ics);
        $this->assertStringNotContainsString(str_replace('-', '', $booking['code']), $ics);

        $this->get("/api/bookings/{$booking['id']}/calendar.ics?sig=falsch")->assertNotFound();
    }

    public function test_offline_pass_gilt_laenger_und_wird_vom_partner_erkannt(): void
    {
        $user = $this->actingAsUser();
        $data = $this->getJson('/api/pass')->assertOk()->json('data');

        $this->assertNotSame($data['token'], $data['offline_token']);
        $this->travel(2)->hours();
        $this->assertNull(Pass::verify($data['token']));
        $this->assertSame($user->id, Pass::verify($data['offline_token']));
        $this->travel(2)->hours();
        $this->assertNull(Pass::verify($data['offline_token']));
    }

    public function test_barrierefreie_angaben_am_partner(): void
    {
        $this->actingAsUser(['is_admin' => true]);
        $partner = $this->partner();
        $offer = $this->offer($partner);

        $this->patchJson("/api/admin/partners/{$partner->id}", [
            'wheelchair_accessible' => true, 'kid_friendly' => false, 'quiet_times' => 'Di–Do vormittags',
        ])->assertOk();

        $this->getJson("/api/offers/{$offer->id}")
            ->assertJsonPath('data.partner.wheelchair_accessible', true)
            ->assertJsonPath('data.partner.kid_friendly', false)
            ->assertJsonPath('data.partner.quiet_times', 'Di–Do vormittags');
        $this->getJson("/api/partners/{$partner->id}")->assertJsonPath('data.wheelchair_accessible', true);
    }

    public function test_jahresabo_zahlt_zehn_monate_und_bringt_jeden_monat_credits(): void
    {
        $user = $this->actingAsUser();
        $this->postJson('/api/club/subscribe', ['plan' => 'gold', 'interval' => 'year'])
            ->assertOk()
            ->assertJsonPath('data.interval', 'year')
            ->assertJsonPath('data.credits', 42);

        $this->assertSame(24990, \App\Models\Payment::where('user_id', $user->id)->sole()->amount_cents);
        $this->assertTrue($user->fresh()->club_renews_at->between(now()->addYear()->subMinute(), now()->addYear()->addMinute()));

        // Jeden Monat Credits, ohne dass erneut bezahlt wird.
        for ($m = 1; $m <= 3; $m++) {
            $this->travel(1)->months();
            ClubMembership::renewDue();
        }
        $this->assertSame(4 * 42, $user->fresh()->credits_balance);
        $this->assertSame(1, \App\Models\Payment::where('user_id', $user->id)->count());

        // Waehrend des Jahres kein Stufenwechsel.
        $this->postJson('/api/club/subscribe', ['plan' => 'platinum'])->assertStatus(422);

        // Nach dem Jahr: monatlich weiter (und monatlich kuendbar), 12 Gutschriften im Jahr.
        $this->travel(9)->months();
        $this->travel(1)->days();
        ClubMembership::renewDue();
        $fresh = $user->fresh();
        $this->assertSame('month', $fresh->club_interval);
        $this->assertSame(13 * 42, $fresh->credits_balance);
        $this->assertSame(2, \App\Models\Payment::where('user_id', $user->id)->count());
        $this->assertSame(2499, \App\Models\Payment::where('user_id', $user->id)->latest('id')->first()->amount_cents);
    }

    public function test_monatsabo_auf_jahresabo_umstellen(): void
    {
        $user = $this->actingAsUser();
        $this->postJson('/api/club/subscribe', ['plan' => 'platinum'])->assertOk()->assertJsonPath('data.interval', 'month');
        $this->postJson('/api/club/subscribe', ['plan' => 'platinum'])->assertStatus(422);
        $this->postJson('/api/club/subscribe', ['plan' => 'platinum', 'interval' => 'year'])->assertOk()->assertJsonPath('data.interval', 'year');
        $this->getJson('/api/user')->assertJsonPath('user.club_interval', 'year');
        unset($user);
    }

    public function test_buchung_hat_keinen_feedback_fuer_nicht_eingeloeste(): void
    {
        $this->actingAsUser();
        $offer = $this->offer($this->partner());
        $booking = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])->json('data');
        $this->assertFalse($booking['feedback_given']);
        $this->assertSame(1, Booking::count());
    }
}
