<?php

namespace Tests\Unit;

use App\Rules\NoBlockedTerms;
use App\Support\BlockedTerms;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Gesperrte Begriffe - ohne Laravel-Anwendung, nur die Klasse und die Regel.
 *
 * Der erste Test ist der wichtigste: dieselben Faelle, die App
 * (src/domain/blocked-terms.test.ts) und Node (server/test/blocked-terms.test.js)
 * durchlaufen. Weicht PHP ab, zeigt die App vorab etwas anderes als der Server
 * entscheidet.
 */
class BlockedTermsTest extends TestCase
{
    private static function shared(string $file): string
    {
        return dirname(__DIR__, 3).'/shared/'.$file;
    }

    private static function terms(): BlockedTerms
    {
        return BlockedTerms::fromFile(self::shared('blocked-terms.json'));
    }

    /** @return array<string, array{0: array}> */
    public static function fixtures(): array
    {
        $data = json_decode((string) file_get_contents(self::shared('blocked-terms.fixtures.json')), true);
        $cases = [];
        foreach ($data['cases'] as $i => $case) {
            $cases[sprintf('#%03d %s (%s)', $i, $case['input'], $case['mode'])] = [$case];
        }

        return $cases;
    }

    #[DataProvider('fixtures')]
    public function test_die_gemeinsamen_faelle_wie_app_und_node(array $case): void
    {
        $hit = self::terms()->find($case['input'], $case['mode']);

        $this->assertSame($case['blocked'], $hit !== null, $case['note'] ?? '');
        if ($case['blocked']) {
            $this->assertSame($case['term'], $hit['term']);
        }
    }

    public function test_die_standardliste_ist_die_aus_shared(): void
    {
        $this->assertSame(realpath(self::shared('blocked-terms.json')), realpath(BlockedTerms::defaultPath()));
    }

    public function test_jeder_begriff_sperrt_sich_selbst(): void
    {
        $terms = self::terms();
        $lists = json_decode((string) file_get_contents(self::shared('blocked-terms.json')), true);
        $checked = 0;
        foreach ($lists['groups'] as $group) {
            foreach (['substring', 'prefix', 'word'] as $kind) {
                foreach ($group[$kind] ?? [] as $term) {
                    foreach ($group['modes'] as $mode) {
                        $this->assertNotNull($terms->find($term, $mode), "{$group['id']}/{$kind}: \"{$term}\" in {$mode}");
                        $checked++;
                    }
                }
            }
        }
        $this->assertGreaterThan(300, $checked);
    }

    public function test_meldungen_je_modus(): void
    {
        $terms = self::terms();
        $this->assertSame('Dieser Benutzername ist nicht erlaubt – bitte wähle einen anderen.', $terms->message('username'));
        $this->assertSame('Dieser Name ist nicht erlaubt.', $terms->message('name'));
        $this->assertSame('Dein Text enthält Wörter, die hier nicht erlaubt sind.', $terms->message('text'));
    }

    public function test_regel_meldet_gesperrte_werte_mit_dem_satz_aus_der_datei(): void
    {
        $messages = $this->runRule(new NoBlockedTerms('username', self::terms()), 'xXhurensohnXx');
        $this->assertSame(['Dieser Benutzername ist nicht erlaubt – bitte wähle einen anderen.'], $messages);

        $this->assertSame(['Dieser Name ist nicht erlaubt.'], $this->runRule(new NoBlockedTerms('name', self::terms()), 'Adolf Hitler'));
    }

    public function test_regel_laesst_harmloses_und_nicht_texte_durch(): void
    {
        $rule = new NoBlockedTerms('name', self::terms());
        $this->assertSame([], $this->runRule($rule, 'Adolf Fick'));
        $this->assertSame([], $this->runRule($rule, ''));
        $this->assertSame([], $this->runRule($rule, null));
        $this->assertSame([], $this->runRule($rule, ['hurensohn']));
    }

    public function test_unbekannter_modus_ist_ein_fehler(): void
    {
        $this->expectException(InvalidArgumentException::class);
        self::terms()->find('x', 'bio');
    }

    /* ---------------------------------------------- Input over the maximum (F-02) */

    /** @return array<string, array{0: array}> */
    public static function lengthFixtures(): array
    {
        $data = json_decode((string) file_get_contents(self::shared('blocked-terms.fixtures.json')), true);
        $cases = [];
        foreach ($data['length_cases'] ?? [] as $i => $case) {
            $cases[sprintf('#%d %s x %d (%s)', $i, json_encode($case['unit']), $case['count'], $case['mode'])] = [$case];
        }
        // A missing key must not turn the data provider into zero cases (a silent pass).
        if (count($cases) < 5) {
            $cases['length_cases missing'] = [['unit' => '', 'count' => 0, 'mode' => 'text', 'blocked' => true]];
        }

        return $cases;
    }

    public function test_the_shared_list_carries_max_input_length_2000(): void
    {
        $lists = json_decode((string) file_get_contents(self::shared('blocked-terms.json')), true);
        $this->assertSame(2000, $lists['max_input_length'] ?? null);
    }

    #[DataProvider('lengthFixtures')]
    public function test_the_shared_length_cases_like_the_app_and_node(array $case): void
    {
        $hit = self::terms()->find(str_repeat($case['unit'], $case['count']), $case['mode']);

        $this->assertSame($case['blocked'], $hit !== null, $case['note'] ?? '');
        if ($case['blocked']) {
            $this->assertSame(['term' => '', 'kind' => 'length'], ['term' => $hit['term'], 'kind' => $hit['kind']]);
        }
    }

    public function test_fails_closed_on_100000_characters_in_under_500_ms_in_every_mode(): void
    {
        $terms = self::terms();
        foreach (BlockedTerms::MODES as $mode) {
            $started = hrtime(true);
            $hit = $terms->find(str_repeat('a', 100_000), $mode);
            $ms = (hrtime(true) - $started) / 1e6;
            $this->assertSame('length', $hit['kind'] ?? null, $mode);
            $this->assertLessThan(500, $ms, "{$mode}: {$ms} ms");
        }
    }

    public function test_the_rule_rejects_an_over_long_value_with_the_mode_message(): void
    {
        $messages = $this->runRule(new NoBlockedTerms('name', self::terms()), str_repeat('Anna ', 500));
        $this->assertSame(['Dieser Name ist nicht erlaubt.'], $messages);
    }

    public function test_a_list_without_a_valid_max_input_length_is_refused(): void
    {
        $lists = json_decode((string) file_get_contents(self::shared('blocked-terms.json')), true);
        foreach ([null, 0, -1, 2.5, '2000'] as $max) {
            $broken = $lists;
            if ($max === null) {
                unset($broken['max_input_length']);
            } else {
                $broken['max_input_length'] = $max;
            }
            try {
                BlockedTerms::fromArray($broken);
                $this->fail('accepted max_input_length '.var_export($max, true));
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('max_input_length', $e->getMessage());
            }
        }
    }

    /** @return list<string> */
    private function runRule(NoBlockedTerms $rule, mixed $value): array
    {
        $messages = [];
        $rule->validate('field', $value, function (string $message) use (&$messages): void {
            $messages[] = $message;
        });

        return $messages;
    }
}
