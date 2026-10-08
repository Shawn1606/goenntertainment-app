<?php

namespace App\Support;

use Carbon\CarbonInterface;
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
 *   Rabatt = Club-Rabatt + Gruppenrabatt der Stufe, hoechstens der Deckel
 *   des Angebots (sonst der allgemeine).
 *
 * Den Gruppenrabatt gibt es in jeder Stufe; Gold und Platinum haben je
 * Personenzahl einen eigenen, hoeheren Wert (Tabelle in club.json).
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

    /**
     * Gruppenrabatt einer Stufe nach Personenzahl: die hoechste Zeile, deren
     * minPeople erreicht ist. Unbekannte Stufen rechnen wie Free.
     */
    public static function groupPercent(?string $planKey, int $people): float
    {
        $key = self::plan($planKey)['key'];
        $percent = 0;
        foreach (self::rules()['groupDiscount']['tiers'] as $tier) {
            $value = $tier['percent'][$key] ?? 0;
            if ($people >= $tier['minPeople'] && $value > $percent) {
                $percent = $value;
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
        $groupPercent = round(self::groupPercent($plan['key'], $count), 2);
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

    /** Mengenbonus eines Pakets (gratis obendrauf), z. B. 200 + 50. */
    public static function packBonus(int $credits): int
    {
        return max(0, (int) (self::rules()['credits']['packBonus'][(string) $credits] ?? 0));
    }

    public static function packTotalCredits(int $credits): int
    {
        return $credits + self::packBonus($credits);
    }

    /**
     * Erstkauf-Bonus: einmalig beim allerersten Paket eines Kontos so viel Prozent
     * der Paketgroesse extra (ohne Mengenbonus). Den Anspruch prueft der Aufrufer.
     */
    public static function firstPurchaseBonus(int $credits): int
    {
        return intdiv($credits * (int) (self::rules()['credits']['firstPurchaseBonusPercent'] ?? 0), 100);
    }

    /**
     * Wie lange Gutschriften in einer Stufe gelten: ['days' => 365] oder
     * ['months' => 18]. Unbekannte Stufen wie Free.
     *
     * @return array{days?: int, months?: int}
     */
    public static function creditValidity(?string $planKey): array
    {
        return self::plan($planKey)['creditValidity'] ?? ['days' => 365];
    }

    /** „365 Tage", „18 Monate". */
    public static function creditValidityLabel(?string $planKey): string
    {
        $v = self::creditValidity($planKey);
        if (! empty($v['months'])) {
            return $v['months'].' '.($v['months'] === 1 ? 'Monat' : 'Monate');
        }
        $days = (int) ($v['days'] ?? 365);

        return $days.' '.($days === 1 ? 'Tag' : 'Tage');
    }

    /** Verfallszeitpunkt einer Gutschrift vom Zeitpunkt `$from` in dieser Stufe. */
    public static function creditExpiry(?string $planKey, CarbonInterface $from): CarbonInterface
    {
        $v = self::creditValidity($planKey);

        return ! empty($v['months'])
            ? $from->copy()->addMonthsNoOverflow((int) $v['months'])
            : $from->copy()->addDays(max(1, (int) ($v['days'] ?? 365)));
    }

    /** Nachfrist fuer stornierte Credits, deren Posten inzwischen verfallen ist. */
    public static function refundGraceDays(): int
    {
        return max(1, (int) (self::rules()['credits']['refundGraceDays'] ?? 30));
    }

    public static function stampFields(): int
    {
        return (int) self::rules()['stampCard']['fields'];
    }

    /** Preis einer Laufzeit: Monat oder Jahr (Jahresabo = 10 Monatspreise). */
    public static function periodPriceCents(?string $planKey, string $interval): int
    {
        $plan = self::plan($planKey);

        return $interval === 'year'
            ? (int) ($plan['yearlyPriceCents'] ?? $plan['priceCents'] * 12)
            : (int) $plan['priceCents'];
    }

    /**
     * Testphase: Happy Hour - Credit-Buchungen mit Wunschtermin an ruhigen
     * Wochentagen kosten Club-Mitglieder weniger. 0, wenn nichts gilt.
     */
    public static function happyHourPercent(?string $planKey, ?string $day): float
    {
        if ($day === null) {
            return 0.0;
        }
        $rules = self::rules()['testphase']['happyHour'] ?? null;
        $weekday = (int) \Illuminate\Support\Carbon::parse($day)->isoWeekday();
        if ($rules === null || ! in_array($weekday, $rules['weekdays'] ?? [], true)) {
            return 0.0;
        }

        return (float) ($rules['percent'][self::plan($planKey)['key']] ?? 0);
    }

    /** Ist die n-te volle Karte (ab 1 gezaehlt) eine goldene? */
    public static function isGoldenCard(int $cardNumber): bool
    {
        $every = (int) (self::rules()['stampCard']['goldenEvery'] ?? 0);

        return $every > 0 && $cardNumber > 0 && $cardNumber % $every === 0;
    }

    /**
     * Was die n-te volle Stempelkarte bringt: der Wert der Stufe, auf einer
     * goldenen Karte mal goldenMultiplier (kaufmaennisch gerundet).
     */
    public static function stampReward(?string $planKey, int $cardNumber): int
    {
        $byPlan = self::rules()['stampCard']['rewardCreditsByPlan'];
        $base = (int) ($byPlan[self::plan($planKey)['key']] ?? $byPlan['free'] ?? 0);

        return self::isGoldenCard($cardNumber)
            ? (int) round($base * (float) self::rules()['stampCard']['goldenMultiplier'])
            : $base;
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
