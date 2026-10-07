<?php

namespace Tests\Unit;

use App\Support\Club;
use PHPUnit\Framework\TestCase;

/**
 * Dieselben Faelle wie src/domain/club.test.ts in der App - aus
 * shared/club.fixtures.json. Rechnen beide Seiten verschieden, zeigt die App
 * einen anderen Preis, als abgebucht wird.
 */
class ClubTest extends TestCase
{
    private static function fixtures(): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__, 3).'/shared/club.fixtures.json'), true);
    }

    public function test_euro_preise_der_gemeinsamen_faelle(): void
    {
        foreach (self::fixtures()['quotes'] as $c) {
            $q = Club::quoteMoney($c['plan'], $c['people'], $c['unitPriceCents'], $c['maxDiscountPercent'] ?? null);
            $this->assertEquals($c['expect']['percent'], $q['percent'], $c['name'].': Prozent');
            $this->assertSame($c['expect']['subtotalCents'], $q['subtotalCents'], $c['name'].': Zwischensumme');
            $this->assertSame($c['expect']['discountCents'], $q['discountCents'], $c['name'].': Rabatt');
            $this->assertSame($c['expect']['totalCents'], $q['totalCents'], $c['name'].': Summe');
        }
    }

    public function test_credit_preise_der_gemeinsamen_faelle(): void
    {
        foreach (self::fixtures()['creditQuotes'] as $c) {
            $q = Club::quoteCredits($c['plan'], $c['people'], $c['unitCredits']);
            $this->assertEquals($c['expect']['percent'], $q['percent'], $c['name']);
            $this->assertSame($c['expect']['subtotalCredits'], $q['subtotalCredits'], $c['name']);
            $this->assertSame($c['expect']['totalCredits'], $q['totalCredits'], $c['name']);
        }
    }

    public function test_paketpreise(): void
    {
        $fixtures = self::fixtures()['packPrices'];
        $this->assertSame(array_column($fixtures, 'credits'), Club::packs());
        foreach ($fixtures as $p) {
            $this->assertSame($p['priceCents'], Club::packPriceCents($p['credits']));
            $this->assertSame($p['bonus'], Club::packBonus($p['credits']));
            $this->assertSame($p['totalCredits'], Club::packTotalCredits($p['credits']));
            $this->assertSame($p['firstPurchaseBonus'], Club::firstPurchaseBonus($p['credits']));
        }
    }

    public function test_stempelkarte_je_stufe_und_goldene_karte(): void
    {
        foreach (self::fixtures()['stampRewards'] as $c) {
            $this->assertSame($c['expect'], Club::stampReward($c['plan'], $c['card']), "{$c['plan']}, Karte {$c['card']}");
        }
        $this->assertTrue(Club::isGoldenCard(5));
        $this->assertFalse(Club::isGoldenCard(4));
    }

    public function test_monats_credits_und_gueltigkeit_je_stufe(): void
    {
        foreach (Club::rules()['plans'] as $plan) {
            $exact = $plan['priceCents'] * 0.125 / (Club::rules()['credits']['centsPerTenCredits'] / 10);
            $this->assertSame((int) round($exact), $plan['monthlyCredits'], $plan['key']);
        }
        $this->assertSame('365 Tage', Club::creditValidityLabel('free'));
        $this->assertSame('18 Monate', Club::creditValidityLabel('gold'));
        $this->assertSame('30 Monate', Club::creditValidityLabel('platinum'));
    }

    public function test_gruppenrabatt_je_stufe(): void
    {
        foreach (self::fixtures()['groupPercents'] as $c) {
            $this->assertEquals($c['expect'], Club::groupPercent($c['plan'], $c['people']), "{$c['plan']}, {$c['people']} Personen");
        }
        $this->assertEquals(10, Club::groupPercent('free', 1000));
        $this->assertEquals(10, Club::groupPercent('gold', 1000));
        $this->assertEquals(10, Club::groupPercent('platinum', 1000));
        // Club + Gruppe zusammen hoechstens 20 %.
        $this->assertEquals(20, Club::discount('platinum', 1000)['percent']);
        $this->assertFalse(Club::discount('platinum', 1000)['capped']);
    }

    public function test_stempelkarte(): void
    {
        foreach (self::fixtures()['stampProgress'] as $c) {
            $p = Club::stampProgress($c['total']);
            $this->assertSame($c['expect']['filled'], $p['filled'], "total {$c['total']}");
            $this->assertSame($c['expect']['completedCards'], $p['completedCards'], "total {$c['total']}");
        }
    }

    public function test_bezahlte_stufen(): void
    {
        $this->assertFalse(Club::isPaidPlan('free'));
        $this->assertTrue(Club::isPaidPlan('gold'));
        $this->assertTrue(Club::isPaidPlan('platinum'));
        $this->assertFalse(Club::isPaidPlan('diamond'));
        $this->assertSame('free', Club::plan('diamond')['key']);
    }
}
