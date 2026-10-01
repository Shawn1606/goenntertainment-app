<?php

namespace App\Support;

use InvalidArgumentException;
use Normalizer;
use RuntimeException;

/**
 * Gesperrte Begriffe in Namen, Benutzernamen und Texten.
 *
 * Die deterministische erste Stufe vor der KI-Moderation: Sie greift immer, ohne
 * Netz und ohne Schluessel. Laravel prueft damit Registrierung und Profil
 * (siehe App\Rules\NoBlockedTerms); die App prueft vorher dasselbe, Node den Rest.
 *
 * ## Eine Liste, drei Umsetzungen
 *
 * Die Begriffe stehen in shared/blocked-terms.json, die Vorschrift ist
 * ausfuehrlich in server/src/blocked-terms.js beschrieben; diese Klasse rechnet
 * Schritt fuer Schritt dasselbe wie dort und wie src/domain/blocked-terms.ts. Die
 * gemeinsamen Faelle in shared/blocked-terms.fixtures.json haelt der Unit-Test
 * gegen alle drei – wer hier etwas aendert, aendert es dort mit.
 *
 * ## Stellen, an denen PHP anders tickt als JS (und warum der Code so aussieht)
 *
 * - Zeichen: `mb_str_split`, nicht `str_split` – JS zaehlt Codepunkte, nicht Bytes.
 * - `\x0B` statt `\v` im Trenn-Muster: PCRE versteht unter `\v` jeden senkrechten
 *   Leerraum (auch U+0085), JS nur den Tabulator.
 * - Die Suchzeilen bestehen nur noch aus a-z, 0-9, Leerzeichen und `|`. Darum
 *   laufen die Muster OHNE /u, und Byte-Versatz = Zeichen-Versatz.
 * - Schluessel wie "0" und "1" (Leet-Tabelle) werden in PHP-Arrays zu Ganzzahlen;
 *   `array_key_exists` findet sie mit dem Zeichen trotzdem.
 * - Ohne intl-Erweiterung fehlt `Normalizer`. Dann uebernimmt die Zeichentabelle
 *   die gaengigen Akzentbuchstaben, und Vollbreite wird von Hand umgerechnet;
 *   exotische Schriften (mathematische Fettschrift u. a.) fallen dann durch.
 */
final class BlockedTerms
{
    public const MODES = ['username', 'name', 'text'];

    private const LINE_SEPARATOR = ' | ';

    private static ?self $default = null;

    /** @var array{umlauts: array, leet: array, leet_alt: array, chars: array} */
    private array $table;

    /** @var list<array{id: string, modes: list<string>, terms: list<array{term: string, kind: string, inChunks: ?string, inTokens: ?string}>}> */
    private array $groups = [];

    /** @var list<string> */
    private array $allow = [];

    /** @var array<string, string> */
    private array $messages;

    /** Longest input examined, in code points (shared/blocked-terms.json `max_input_length`). */
    private int $maxInputLength;

    /** Die Liste des Projekts, einmal geladen und vorbereitet. */
    public static function default(): self
    {
        return self::$default ??= self::fromFile(self::defaultPath());
    }

    /**
     * shared/ liegt NEBEN api/ im Repo, weil App und Node dieselbe Datei lesen.
     * Wer Laravel ausrollt, muss den Ordner also mitnehmen (siehe deploy/README.md).
     */
    public static function defaultPath(): string
    {
        return dirname(__DIR__, 3).'/shared/blocked-terms.json';
    }

    /**
     * Fehlt die Datei, gibt es einen Fehler statt einer leeren Liste: Diese Stufe
     * soll immer greifen, und eine Registrierung, die stillschweigend ohne sie
     * durchgeht, faellt erst auf, wenn der Name schon oeffentlich ist.
     */
    public static function fromFile(string $path): self
    {
        $raw = is_readable($path) ? file_get_contents($path) : false;
        if ($raw === false) {
            throw new RuntimeException("Liste gesperrter Begriffe nicht lesbar: {$path}");
        }

        $lists = json_decode($raw, true);
        if (! is_array($lists)) {
            throw new RuntimeException("Liste gesperrter Begriffe ist kein gueltiges JSON: {$path}");
        }

        return self::fromArray($lists);
    }

    public static function fromArray(array $lists): self
    {
        return new self($lists);
    }

    private function __construct(array $lists)
    {
        $normalize = $lists['normalize'] ?? [];
        $this->table = [
            'umlauts' => $normalize['umlauts'] ?? [],
            'leet' => $normalize['leet'] ?? [],
            'leet_alt' => $normalize['leet_alt'] ?? [],
            'chars' => $normalize['chars'] ?? [],
        ];
        $this->messages = $lists['messages'] ?? [];

        // Without a bound the patterns can be made slow (F-02): a list without one is unusable.
        $max = $lists['max_input_length'] ?? null;
        if (! is_int($max) || $max < 1) {
            throw new RuntimeException('Liste gesperrter Begriffe: max_input_length fehlt oder ist keine positive ganze Zahl');
        }
        $this->maxInputLength = $max;

        foreach ($lists['groups'] ?? [] as $group) {
            $seen = [];
            $terms = [];
            foreach (['substring', 'prefix', 'word'] as $kind) {
                foreach ($group[$kind] ?? [] as $term) {
                    $compiled = $this->compileTerm((string) $term, $kind);
                    if ($compiled === null || isset($seen[$compiled['key']])) {
                        continue;
                    }
                    $seen[$compiled['key']] = true;
                    unset($compiled['key']);
                    $terms[] = $compiled;
                }
            }
            $this->groups[] = ['id' => (string) $group['id'], 'modes' => $group['modes'] ?? [], 'terms' => $terms];
        }

        foreach ($lists['allow'] ?? [] as $word) {
            $squashed = implode('', $this->termTokens((string) $word));
            if ($squashed !== '') {
                $this->allow[] = '/'.self::runsPattern($squashed).'/';
            }
        }
    }

    /**
     * Enthaelt `$text` einen gesperrten Begriff?
     *
     * @return array{term: string, group: string, kind: string}|null Der erste Treffer
     *   in Listen-Reihenfolge - oder null. Input longer than max_input_length code points is a
     *   hit of kind 'length' before anything else runs (fail closed, F-02): the patterns get slow
     *   on very long input, and PCRE's backtracking limit would end a long run with an error or
     *   a silent miss. Same rule and order as server/src/blocked-terms.js and the app.
     */
    public function find(?string $text, string $mode): ?array
    {
        if (! in_array($mode, self::MODES, true)) {
            throw new InvalidArgumentException("Unbekannter Pruefmodus: {$mode}");
        }
        if ($text === null) {
            return null;
        }
        if (self::exceedsMaxInput($text, $this->maxInputLength)) {
            return ['term' => '', 'group' => 'max_input_length', 'kind' => 'length'];
        }
        if (trim($text) === '') {
            return null;
        }

        $analysis = $this->analyse($text);
        $chunkLine = implode(self::LINE_SEPARATOR, $analysis['chunks']);
        $tokenLine = implode(self::LINE_SEPARATOR, $analysis['tokens']);
        $spanCache = [];

        foreach ($this->groups as $group) {
            if (! in_array($mode, $group['modes'], true)) {
                continue;
            }
            foreach ($group['terms'] as $term) {
                $hit = ($term['inChunks'] !== null && $this->hasUncoveredHit($term['inChunks'], $chunkLine, $spanCache))
                    || ($term['inTokens'] !== null && $this->hasUncoveredHit($term['inTokens'], $tokenLine, $spanCache));
                if ($hit) {
                    return ['term' => $term['term'], 'group' => $group['id'], 'kind' => $term['kind']];
                }
            }
        }

        return null;
    }

    /**
     * Does $text have more than $max code points? Bounded: a string of at most $max bytes cannot,
     * one of more than 4 * $max bytes must (UTF-8 uses at most 4 bytes per code point); only in
     * between are the code points counted. Code points, as in the JS implementations.
     */
    public static function exceedsMaxInput(string $text, int $max): bool
    {
        $bytes = strlen($text);
        if ($bytes <= $max) {
            return false;
        }
        if ($bytes > 4 * $max) {
            return true;
        }

        return mb_strlen($text, 'UTF-8') > $max;
    }

    /** Der Satz fuer einen Modus - derselbe, den App und Node zeigen. */
    public function message(string $mode): string
    {
        return (string) ($this->messages[$mode] ?? 'Dieser Wert ist nicht erlaubt.');
    }

    /**
     * Der Text in den Formen, in denen gesucht wird.
     *
     * @return array{chunks: list<string>, tokens: list<string>}
     */
    public function analyse(string $text): array
    {
        $text = mb_scrub($text, 'UTF-8');
        $plain = $this->variants($text);
        $camel = self::splitCamel($text);
        $withCamel = $camel === $text ? $plain : array_merge($plain, $this->variants($camel));

        return [
            'chunks' => self::unique(array_map([self::class, 'chunkLine'], $plain)),
            'tokens' => self::unique(array_map([self::class, 'tokenLine'], $withCamel)),
        ];
    }

    // --- Normalisierung ------------------------------------------------------

    /** Schritt 1: NFKD, Vollbreite, Kleinschreibung. */
    private static function prepare(string $text): string
    {
        $s = $text;
        if (class_exists(Normalizer::class)) {
            $normalized = Normalizer::normalize($s, Normalizer::FORM_KD);
            if (is_string($normalized)) {
                $s = $normalized;
            }
        }
        $s = (string) preg_replace_callback(
            '/[\x{FF01}-\x{FF5E}]/u',
            static fn (array $m): string => mb_chr(mb_ord($m[0], 'UTF-8') - 0xFEE0, 'UTF-8'),
            $s,
        );

        return mb_strtolower($s, 'UTF-8');
    }

    /** Schritt 2: Umlaute (nur Variante A), Zeichentabelle, kombinierende Zeichen. */
    private function fold(string $prepared, bool $umlautVariant): string
    {
        $cps = mb_str_split($prepared, 1, 'UTF-8');
        $count = count($cps);
        $out = '';
        for ($i = 0; $i < $count; $i++) {
            $ch = $cps[$i];
            if ($umlautVariant) {
                if ($i + 1 < $count && array_key_exists($ch.$cps[$i + 1], $this->table['umlauts'])) {
                    $out .= $this->table['umlauts'][$ch.$cps[$i + 1]];
                    $i++;

                    continue;
                }
                if (array_key_exists($ch, $this->table['umlauts'])) {
                    $out .= $this->table['umlauts'][$ch];

                    continue;
                }
            }
            if (array_key_exists($ch, $this->table['chars'])) {
                $out .= $this->table['chars'][$ch];

                continue;
            }
            $cp = mb_ord($ch, 'UTF-8');
            if ($cp >= 0x300 && $cp <= 0x36F) {
                continue;
            }
            $out .= $ch;
        }

        return $out;
    }

    private static function isLetter(string $ch): bool
    {
        return strlen($ch) === 1 && $ch >= 'a' && $ch <= 'z';
    }

    private static function isDigit(string $ch): bool
    {
        return strlen($ch) === 1 && ord($ch) >= 48 && ord($ch) <= 57;
    }

    /** Schritt 3: Leetspeak - alles oder nur innen, 1 als i oder l. */
    private function leet(string $folded, string $oneAs, bool $innerOnly): string
    {
        $cps = mb_str_split($folded, 1, 'UTF-8');
        $count = count($cps);
        $isRunChar = fn (string $ch): bool => self::isLetter($ch) || self::isDigit($ch)
            || array_key_exists($ch, $this->table['leet']);
        $mapChar = function (string $ch) use ($oneAs): string {
            if (self::isLetter($ch)) {
                return $ch;
            }
            if ($oneAs === 'l' && array_key_exists($ch, $this->table['leet_alt'])) {
                return (string) $this->table['leet_alt'][$ch];
            }

            return array_key_exists($ch, $this->table['leet']) ? (string) $this->table['leet'][$ch] : '';
        };

        $out = '';
        $i = 0;
        while ($i < $count) {
            if (! $isRunChar($cps[$i])) {
                $out .= $cps[$i];
                $i++;

                continue;
            }
            $j = $i;
            while ($j < $count && $isRunChar($cps[$j])) {
                $j++;
            }
            $run = array_slice($cps, $i, $j - $i);
            $i = $j;

            $hasLetter = false;
            foreach ($run as $ch) {
                if (self::isLetter($ch)) {
                    $hasLetter = true;
                    break;
                }
            }
            if (! $hasLetter) {
                $out .= implode('', $run);

                continue;
            }

            $from = 0;
            $to = count($run);
            $prefix = '';
            $suffix = '';
            if ($innerOnly) {
                while (! self::isLetter($run[$from])) {
                    $from++;
                }
                while (! self::isLetter($run[$to - 1])) {
                    $to--;
                }
                if ($from > 0) {
                    $prefix = ' ';
                }
                if ($to < count($run)) {
                    $suffix = ' ';
                }
            }
            $out .= $prefix.implode('', array_map($mapChar, array_slice($run, $from, $to - $from))).$suffix;
        }

        return $out;
    }

    /** @return list<string> */
    private function variants(string $text): array
    {
        $prepared = self::prepare($text);
        $out = [];
        foreach ([$this->fold($prepared, true), $this->fold($prepared, false)] as $f) {
            $out[] = $f;
            $out[] = $this->leet($f, 'i', false);
            $out[] = $this->leet($f, 'i', true);
            $out[] = $this->leet($f, 'l', false);
            $out[] = $this->leet($f, 'l', true);
        }

        return self::unique($out);
    }

    /** camelCase-Grenzen als Leerzeichen - auf dem Originaltext. */
    private static function splitCamel(string $text): string
    {
        $cps = mb_str_split($text, 1, 'UTF-8');
        $out = '';
        foreach ($cps as $i => $ch) {
            $prev = $i > 0 ? $cps[$i - 1] : null;
            $prevIsLower = $prev !== null && mb_strtoupper($prev, 'UTF-8') !== $prev
                && mb_strtolower($prev, 'UTF-8') === $prev;
            $isUpper = mb_strtolower($ch, 'UTF-8') !== $ch;
            if ($prevIsLower && $isUpper) {
                $out .= ' ';
            }
            $out .= $ch;
        }

        return $out;
    }

    /**
     * @param  list<string>  $items
     * @return list<string>
     */
    private static function mergeSingles(array $items): array
    {
        $out = [];
        $run = [];
        $flush = function () use (&$out, &$run): void {
            if (count($run) >= 3) {
                $out[] = implode('', $run);
            } else {
                array_push($out, ...$run);
            }
            $run = [];
        };
        foreach ($items as $item) {
            if (strlen($item) === 1 && self::isLetter($item)) {
                $run[] = $item;
            } else {
                $flush();
                $out[] = $item;
            }
        }
        $flush();

        return $out;
    }

    private static function chunkLine(string $variant): string
    {
        $chunks = [];
        foreach (preg_split('/[ \t\n\r\f\x0B]+/', $variant) ?: [] as $chunk) {
            $squashed = (string) preg_replace('/[^a-z0-9]+/', '', $chunk);
            if ($squashed !== '') {
                $chunks[] = $squashed;
            }
        }

        return implode(' ', self::mergeSingles($chunks));
    }

    private static function tokenLine(string $variant): string
    {
        preg_match_all('/[a-z]+|[0-9]+/', $variant, $m);

        return implode(' ', self::mergeSingles($m[0]));
    }

    /**
     * @param  list<string>  $items
     * @return list<string>
     */
    private static function unique(array $items): array
    {
        return array_values(array_unique($items));
    }

    // --- Begriffe ------------------------------------------------------------

    private static function runsPattern(string $s): string
    {
        $out = '';
        $len = strlen($s);
        $i = 0;
        while ($i < $len) {
            $j = $i;
            while ($j < $len && $s[$j] === $s[$i]) {
                $j++;
            }
            $count = $j - $i;
            $out .= $count === 1 ? $s[$i].'+' : $s[$i].'{'.$count.',}';
            $i = $j;
        }

        return $out;
    }

    /** @return list<string> */
    private function termTokens(string $term): array
    {
        preg_match_all('/[a-z]+|[0-9]+/', $this->fold(self::prepare($term), true), $m);

        return $m[0];
    }

    /** @return array{term: string, kind: string, inChunks: ?string, inTokens: ?string, key: string}|null */
    private function compileTerm(string $term, string $kind): ?array
    {
        $tokens = $this->termTokens($term);
        if ($tokens === []) {
            return null;
        }
        $sequence = implode(' ?', array_map([self::class, 'runsPattern'], $tokens));
        $compiled = ['term' => $term, 'kind' => $kind, 'inChunks' => null, 'inTokens' => null, 'key' => $kind.':'.implode(' ', $tokens)];

        if ($kind === 'substring') {
            $compiled['inChunks'] = '/'.self::runsPattern(implode('', $tokens)).'/';
            if (count($tokens) > 1) {
                $compiled['inTokens'] = '/(?:^| )'.$sequence.'(?= |$)/';
            }
        } elseif ($kind === 'prefix') {
            $compiled['inTokens'] = '/(?:^| )'.$sequence.'/';
        } else {
            $compiled['inTokens'] = '/(?:^| )'.$sequence.'(?= |$)/';
        }

        return $compiled;
    }

    /** @return list<array{0: int, 1: int}> */
    private static function spans(string $pattern, string $line): array
    {
        $out = [];
        preg_match_all($pattern, $line, $m, PREG_OFFSET_CAPTURE);
        foreach ($m[0] as [$text, $offset]) {
            $start = $offset + (($text[0] ?? '') === ' ' ? 1 : 0);
            $out[] = [$start, $offset + strlen($text)];
        }

        return $out;
    }

    private function hasUncoveredHit(string $pattern, string $line, array &$spanCache): bool
    {
        foreach (self::spans($pattern, $line) as [$start, $end]) {
            if (! array_key_exists($line, $spanCache)) {
                $allowed = [];
                foreach ($this->allow as $allowPattern) {
                    array_push($allowed, ...self::spans($allowPattern, $line));
                }
                $spanCache[$line] = $allowed;
            }
            $covered = false;
            foreach ($spanCache[$line] as [$from, $to]) {
                if ($from <= $start && $to >= $end) {
                    $covered = true;
                    break;
                }
            }
            if (! $covered) {
                return true;
            }
        }

        return false;
    }
}
