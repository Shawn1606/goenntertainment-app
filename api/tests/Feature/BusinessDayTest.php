<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Support\Bookings;
use App\Support\BusinessDay;
use App\Support\TestPhase\Bingo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

/**
 * Geschaeftstage in Ortszeit (App\Support\BusinessDay), auch wenn der Server in UTC rechnet - wie
 * im Container (deploy/docker-compose.yml: APP_TIMEZONE=UTC). Jeder Test hier stellt die Zeitzone
 * der Anwendung auf UTC und prueft die Tagesgrenze in Goettingen: Mitternacht dort ist 22:00 bzw.
 * 23:00 Uhr UTC am Vortag.
 */
class BusinessDayTest extends MarketplaceTestCase
{
    private string $savedTimezone;

    protected function setUp(): void
    {
        parent::setUp();
        $this->savedTimezone = date_default_timezone_get();
        date_default_timezone_set('UTC');
        config(['app.timezone' => 'UTC']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        date_default_timezone_set($this->savedTimezone);
        parent::tearDown();
    }

    private static function utc(string $at): Carbon
    {
        return Carbon::parse($at, 'UTC');
    }

    private function visit(int $userId, int $partnerId, string $utc): void
    {
        DB::table('stamps')->insert([
            'user_id' => $userId,
            'partner_id' => $partnerId,
            'stamp_day' => BusinessDay::local(self::utc($utc))->toDateString(),
            'created_at' => self::utc($utc),
        ]);
    }

    public function test_eine_buchung_gilt_bis_zum_ende_des_tages_in_ortszeit(): void
    {
        // 22:30 Uhr UTC am 8. Oktober ist in Goettingen schon der 9. Oktober, 00:30 Uhr.
        Carbon::setTestNow(self::utc('2026-10-08 22:30:00'));
        $this->actingAsUser();
        $offer = $this->offer($this->partner(), ['valid_days' => 1]);

        $id = $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money'])
            ->assertCreated()
            ->assertJsonPath('data.valid_until', '2026-10-10T21:59:59+00:00')
            ->json('data.id');

        // Gespeichert in app.timezone: das Ende des 10. Oktober in Goettingen, nicht des 9. in UTC.
        $this->assertSame('2026-10-10 21:59:59', (string) DB::table('bookings')->where('id', $id)->value('valid_until'));
        $this->assertSame('2026-10-10 23:59:59', BusinessDay::local(Booking::findOrFail($id)->valid_until)->format('Y-m-d H:i:s'));
    }

    public function test_ein_stempel_je_partner_und_tag_zaehlt_den_tag_in_ortszeit(): void
    {
        $user = $this->actingAsUser();
        $partner = $this->partner();
        $checkin = fn () => $this->postJson('/api/checkins', ['token' => $partner->checkin_token, 'method' => 'nfc'])->assertCreated();

        Carbon::setTestNow(self::utc('2026-10-08 21:30:00')); // 23:30 Uhr in Goettingen
        $checkin()->assertJsonPath('data.stamped', true);

        // 00:30 Uhr in Goettingen - in UTC noch derselbe Tag, dort aber ein neuer: ein neuer Stempel.
        Carbon::setTestNow(self::utc('2026-10-08 22:30:00'));
        $checkin()->assertJsonPath('data.stamped', true);

        // Eine Stunde spaeter, derselbe Tag in Goettingen: keiner mehr.
        Carbon::setTestNow(self::utc('2026-10-08 23:30:00'));
        $checkin()->assertJsonPath('data.stamped', false);

        $days = DB::table('stamps')->where('user_id', $user->id)->orderBy('id')->pluck('stamp_day')
            ->map(fn ($day) => substr((string) $day, 0, 10))->all();
        $this->assertSame(['2026-10-08', '2026-10-09'], $days);
    }

    public function test_heute_ist_fuer_den_wunschtermin_der_tag_in_ortszeit(): void
    {
        Carbon::setTestNow(self::utc('2026-10-08 22:30:00')); // 9. Oktober, 00:30 Uhr in Goettingen
        $this->actingAsUser();
        $offer = $this->offer($this->partner());
        $book = fn (string $day) => $this->postJson('/api/bookings', ['offer_id' => $offer->id, 'people' => 1, 'pay_method' => 'money', 'preferred_date' => $day]);

        $book('2026-10-08')->assertStatus(422)->assertJsonValidationErrors('preferred_date');
        $book('2026-10-09')->assertCreated()->assertJsonPath('data.preferred_date', '2026-10-09');
    }

    public function test_der_partner_sieht_heute_eingeloeste_ab_mitternacht_ortszeit(): void
    {
        $partner = $this->partner();
        $offer = $this->offer($partner);
        $staff = $this->user();
        $partner->staff()->attach($staff->id, ['role' => 'staff', 'created_at' => now()]);
        $customer = $this->user();

        // Eingeloest um 23:30 Uhr (gestern) und um 00:30 Uhr (heute) Ortszeit.
        foreach (['2026-10-08 21:30:00', '2026-10-08 22:30:00'] as $at) {
            Carbon::setTestNow(self::utc($at));
            Bookings::redeem(Bookings::create($customer, $offer, 1, 'money', null, null));
        }

        Carbon::setTestNow(self::utc('2026-10-09 06:00:00')); // 08:00 Uhr in Goettingen
        Sanctum::actingAs($staff);
        $this->getJson('/api/partner/bookings?partner_id='.$partner->id)
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.redeemed_at', '2026-10-08T22:30:00+00:00');
    }

    public function test_die_tagesreihe_im_admin_bereich_zaehlt_tage_in_ortszeit(): void
    {
        Carbon::setTestNow(self::utc('2026-10-09 06:00:00')); // 08:00 Uhr in Goettingen
        $admin = $this->actingAsUser();
        $admin->forceFill(['is_admin' => true])->save();
        // Angemeldet um 23:30 Uhr am 8. und um 00:30 Uhr am 9. Oktober in Goettingen.
        $this->user(['created_at' => self::utc('2026-10-08 21:30:00')]);
        $this->user(['created_at' => self::utc('2026-10-08 22:30:00')]);

        $signups = collect($this->getJson('/api/admin/stats')->assertOk()->json('series.signups'))->pluck('count', 'date');

        $this->assertSame('2026-10-09', $signups->keys()->last());
        $this->assertSame(1, $signups['2026-10-08']);
        $this->assertSame(2, $signups['2026-10-09']);
    }

    public function test_bingo_vor_12_uhr_und_wochenende_nach_ortszeit(): void
    {
        $user = $this->user();
        // Ein pausierter Partner bekommt kein Feld: So liegen alle acht Aufgaben aus.
        $partner = $this->partner(['is_active' => false]);
        $done = fn (string $task) => collect(Bingo::board($user, now())['cells'])->firstWhere('task', $task)['done'];
        Carbon::setTestNow(self::utc('2026-10-14 08:00:00'));

        // Mittwoch, 12:30 Uhr in Goettingen (10:30 UTC): nicht „vor 12 Uhr", kein Wochenende.
        $this->visit($user->id, $partner->id, '2026-10-07 10:30:00');
        $this->assertFalse($done('morning'));
        $this->assertFalse($done('weekend'));

        // Samstag, 00:30 Uhr in Goettingen (Freitag, 22:30 UTC): vor 12 Uhr und am Wochenende.
        $this->visit($user->id, $partner->id, '2026-10-09 22:30:00');
        $this->assertTrue($done('morning'));
        $this->assertTrue($done('weekend'));
    }

    public function test_der_bingo_monat_beginnt_um_mitternacht_ortszeit(): void
    {
        $user = $this->user();
        $partner = $this->partner(['is_active' => false]);
        // 1. November, 00:30 Uhr in Goettingen = 31. Oktober, 23:30 UTC (Winterzeit, UTC+1).
        $this->visit($user->id, $partner->id, '2026-10-31 23:30:00');

        Carbon::setTestNow(self::utc('2026-11-01 07:00:00')); // 08:00 Uhr in Goettingen
        $board = Bingo::board($user, now());

        $this->assertSame('2026-11', $board['period']);
        $this->assertTrue(collect($board['cells'])->firstWhere('task', 'morning')['done'], 'the visit belongs to November in Goettingen');
    }
}
