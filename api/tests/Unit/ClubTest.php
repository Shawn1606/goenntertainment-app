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
        }
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
