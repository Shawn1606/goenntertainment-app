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
