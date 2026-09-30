<?php

namespace App\Support;

use RuntimeException;

/**
 * Die Club-Regeln: Stufen, Rabatte, Credit-Pakete, Stempelkarte.
 *
 * ## Eine Datei, zwei Umsetzungen
 *
 * Die Zahlen stehen in shared/club.json. Diese Klasse rechnet damit Schritt fuer
 * Schritt dasselbe wie src/domain/club.ts in der App; die gemeinsamen Faelle in
 * shared/club.fixtures.json haelt der Unit-Test gegen beide (ClubTest bzw.
 * club.test.ts). Wer hier etwas aendert, aendert es dort mit.
 *
 * Massgeblich ist diese Seite: Die App zeigt eine Vorschau, abgebucht wird, was
 * hier herauskommt.
 *
 * ## Die Regel
 *
 *   Rabatt = Club-Rabatt + Gruppenrabatt x Club-Faktor, hoechstens der Deckel
 *   des Angebots (sonst der allgemeine).
 *
 * Euro kaufmaennisch auf den Cent, Credits aufgerundet. PHPs `round` rundet
 * halbe Werte von null weg, JS `Math.round` nach oben - fuer die hier immer
 * positiven Betraege ist das dasselbe.
 */
final class Club
{
    private static ?array $rules = null;

    public static function path(): string
    {
        return dirname(__DIR__, 3).'/shared/club.json';
    }

    /** Die Regeln, einmal gelesen. Fehlt die Datei, ist das ein Fehler - kein Rabatt von 0. */
    public static function rules(): array
    {
        if (self::$rules !== null) {
            return self::$rules;
        }

        $raw = is_readable(self::path()) ? file_get_contents(self::path()) : false;
        $rules = $raw === false ? null : json_decode($raw, true);
        if (! is_array($rules)) {
            throw new RuntimeException('shared/club.json fehlt oder ist kein gueltiges JSON.');
        }

        return self::$rules = $rules;
    }

    /** @return list<string> */
    public static function planKeys(): array
    {
        return array_map(fn (array $p) => $p['key'], self::rules()['plans']);
    }

    /** Die Stufe zu einem Schluessel; Unbekanntes zaehlt als Free. */
    public static function plan(?string $key): array
    {
        foreach (self::rules()['plans'] as $plan) {
            if ($plan['key'] === $key) {
                return $plan;
            }
        }

        return self::rules()['plans'][0];
    }

    /** Gibt es diese Stufe, und kostet sie etwas? */
    public static function isPaidPlan(?string $key): bool
    {
        $plan = self::plan($key);

        return $plan['key'] === $key && $plan['priceCents'] > 0;
    }

    public static function groupBasePercent(int $people): float
    {
        $percent = 0;
        foreach (self::rules()['groupDiscount']['tiers'] as $tier) {
            if ($people >= $tier['minPeople'] && $tier['percent'] > $percent) {
                $percent = $tier['percent'];
            }
        }

        return (float) $percent;
    }

    /**
     * @return array{clubPercent: float, groupPercent: float, percent: float, capped: bool}
     */
    public static function discount(?string $planKey, int $people, ?int $maxDiscountPercent = null): array
    {
        $plan = self::plan($planKey);
        $count = max(1, $people);
        $clubPercent = (float) $plan['discountPercent'];
        $groupPercent = round(self::groupBasePercent($count) * $plan['groupBoost'], 2);
        $cap = (float) ($maxDiscountPercent ?? self::rules()['discountCap']['defaultPercent']);
        $raw = round($clubPercent + $groupPercent, 2);

        return [
            'clubPercent' => $clubPercent,
            'groupPercent' => $groupPercent,
            'percent' => max(0.0, min($raw, $cap)),
            'capped' => $raw > $cap,
        ];
    }

    /**
     * @return array{clubPercent: float, groupPercent: float, percent: float, capped: bool, people: int, unitPriceCents: int, subtotalCents: int, discountCents: int, totalCents: int}
     */
    public static function quoteMoney(?string $planKey, int $people, int $unitPriceCents, ?int $maxDiscountPercent = null): array
    {
        $people = max(1, $people);
        $discount = self::discount($planKey, $people, $maxDiscountPercent);
        $subtotal = $unitPriceCents * $people;
        $discountCents = (int) round($subtotal * $discount['percent'] / 100);

        return $discount + [
            'people' => $people,
            'unitPriceCents' => $unitPriceCents,
            'subtotalCents' => $subtotal,
            'discountCents' => $discountCents,
            'totalCents' => $subtotal - $discountCents,
        ];
    }

    /**
     * @return array{clubPercent: float, groupPercent: float, percent: float, capped: bool, people: int, unitCredits: int, subtotalCredits: int, totalCredits: int}
     */
    public static function quoteCredits(?string $planKey, int $people, int $unitCredits, ?int $maxDiscountPercent = null): array
    {
        $people = max(1, $people);
        $discount = self::discount($planKey, $people, $maxDiscountPercent);
        $subtotal = $unitCredits * $people;
        // Das kleine Minus faengt Fliesskomma-Reste ab - wie in der App.
        $total = (int) ceil($subtotal * (100 - $discount['percent']) / 100 - 1e-9);

        return $discount + [
            'people' => $people,
            'unitCredits' => $unitCredits,
            'subtotalCredits' => $subtotal,
            'totalCredits' => $total,
        ];
    }

    /** @return list<int> */
    public static function packs(): array
    {
        return self::rules()['credits']['packs'];
    }

    public static function packPriceCents(int $credits): int
    {
        return (int) round($credits * self::rules()['credits']['centsPerTenCredits'] / 10);
    }

    public static function stampFields(): int
    {
        return (int) self::rules()['stampCard']['fields'];
    }

    public static function stampRewardCredits(): int
    {
        return (int) self::rules()['stampCard']['rewardCredits'];
    }

    /** @return array{filled: int, fields: int, completedCards: int, remaining: int} */
    public static function stampProgress(int $total): array
    {
        $fields = self::stampFields();
        $safe = max(0, $total);
        $filled = $safe % $fields;

        return [
            'filled' => $filled,
            'fields' => $fields,
            'completedCards' => intdiv($safe, $fields),
            'remaining' => $fields - $filled,
        ];
    }
}
