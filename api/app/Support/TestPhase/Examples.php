<?php

namespace App\Support\TestPhase;

use App\Models\Partner;
use App\Models\TestphaseChallenge;
use Illuminate\Support\Carbon;

/**
 * Beispiel-Challenges zum Ausprobieren - je Art mindestens eine. Legt nur an,
 * was es (nach Titel) noch nicht gibt; mehrfach Aufrufen schadet nicht.
 */
final class Examples
{
    public static function create(): int
    {
        $now = now();
        [$seasonName, $seasonFrom, $seasonTo] = self::season($now);
        $partner = Partner::where('is_active', true)->orderBy('id')->first();

        $examples = [
            ['type' => 'monthly', 'title' => 'Bowling-Profi', 'description' => 'Geh in diesem Monat zehnmal zum Bowling.', 'metric' => 'visits', 'target' => 10, 'reward_credits' => 150, 'period' => 'month', 'match_text' => 'Bowling'],
            ['type' => 'monthly', 'title' => 'Softdrink-Sammler', 'description' => 'Hol dir in diesem Monat fünf Softdrinks über ein Gratis-Angebot und löse sie ein.', 'metric' => 'redeemed', 'target' => 5, 'reward_credits' => 100, 'period' => 'month', 'match_text' => 'Softdrink', 'offer_kind' => 'perk'],
            ['type' => 'monthly', 'title' => 'Entdecker', 'description' => 'Besuche drei verschiedene Partner.', 'metric' => 'distinct_partners', 'target' => 3, 'reward_credits' => 120, 'period' => 'month', 'plans' => ['gold', 'platinum']],
            ['type' => 'monthly', 'title' => 'Neues ausprobieren', 'description' => 'Besuche Partner aus zwei verschiedenen Kategorien.', 'metric' => 'distinct_categories', 'target' => 2, 'reward_credits' => 150, 'period' => 'month', 'plans' => ['platinum']],
            ['type' => 'weekly', 'title' => 'Einmal raus', 'description' => 'Ein Check-in bei einem Partner – irgendwann diese Woche.', 'metric' => 'visits', 'target' => 1, 'reward_credits' => 20, 'period' => 'week'],
            ['type' => 'weekly', 'title' => 'Was vorhaben', 'description' => 'Buche ein Angebot und löse es diese Woche ein.', 'metric' => 'bookings', 'target' => 1, 'reward_credits' => 25, 'period' => 'week'],
            ['type' => 'season', 'title' => $seasonName.'-Challenge', 'description' => 'Fünf Besuche bis zum Ende der Saison.', 'metric' => 'visits', 'target' => 5, 'reward_credits' => 200, 'period' => 'range', 'starts_at' => $seasonFrom, 'ends_at' => $seasonTo],
            ['type' => 'group', 'title' => 'Zusammen unterwegs', 'description' => 'Eure Gruppe löst diesen Monat drei gemeinsame Buchungen ein – jede:r in der Gruppe kann die Belohnung abholen.', 'metric' => 'group_bookings', 'target' => 3, 'reward_credits' => 150, 'period' => 'month'],
        ];

        // Geheime Challenges (11): erst sichtbar, wenn geschafft.
        $examples[] = ['type' => 'weekly', 'title' => 'Dreierpack', 'description' => 'Drei verschiedene Partner in einer Woche.', 'metric' => 'distinct_partners', 'target' => 3, 'reward_credits' => 80, 'period' => 'week', 'is_secret' => true];
        $examples[] = ['type' => 'monthly', 'title' => 'Stammgast', 'description' => 'Fünf Besuche in einem Monat.', 'metric' => 'visits', 'target' => 5, 'reward_credits' => 60, 'period' => 'month', 'is_secret' => true];

        // Challenges mit Wahl (13): fuenf zur Auswahl, drei darf man nehmen.
        foreach ([
            ['Zweimal raus', 'Zwei Besuche bei Partnern.', 'visits', 2, 40],
            ['Neuer Partner', 'Zwei verschiedene Partner besuchen.', 'distinct_partners', 2, 50],
            ['Was buchen', 'Ein Angebot buchen und einlösen.', 'bookings', 1, 40],
            ['Einlösen', 'Ein gebuchtes Angebot beim Partner einlösen.', 'redeemed', 1, 50],
            ['Mit der Gruppe', 'Eine Buchung in einer deiner Gruppen, eingelöst.', 'group_bookings', 1, 60],
        ] as [$title, $description, $metric, $target, $reward]) {
            $examples[] = ['type' => 'monthly', 'title' => 'Wahl: '.$title, 'description' => $description, 'metric' => $metric, 'target' => $target, 'reward_credits' => $reward, 'period' => 'month', 'is_choice' => true];
        }

        if ($partner !== null) {
            $examples[] = ['type' => 'partner', 'title' => '3× bei '.$partner->name, 'description' => 'Eine Challenge des Partners: dreimal vorbeikommen in diesem Monat.', 'metric' => 'visits', 'target' => 3, 'reward_credits' => 100, 'period' => 'month', 'partner_id' => $partner->id];
        }

        $created = 0;
        foreach ($examples as $sort => $example) {
            if (TestphaseChallenge::where('title', $example['title'])->exists()) {
                continue;
            }
            TestphaseChallenge::create($example + ['sort' => $sort]);
            $created++;
        }

        return $created;
    }

    /**
     * Die laufende Jahreszeit (meteorologisch): Name, erster und letzter Tag.
     *
     * @return array{0: string, 1: Carbon, 2: Carbon}
     */
    public static function season(Carbon $now): array
    {
        $year = $now->year;

        return match (true) {
            $now->month >= 3 && $now->month <= 5 => ['Frühlings', Carbon::create($year, 3, 1), Carbon::create($year, 5, 31)],
            $now->month >= 6 && $now->month <= 8 => ['Sommer', Carbon::create($year, 6, 1), Carbon::create($year, 8, 31)],
            $now->month >= 9 && $now->month <= 11 => ['Herbst', Carbon::create($year, 9, 1), Carbon::create($year, 11, 30)],
            $now->month === 12 => ['Winter', Carbon::create($year, 12, 1), Carbon::create($year + 1, 2, 1)->endOfMonth()],
            default => ['Winter', Carbon::create($year - 1, 12, 1), Carbon::create($year, 2, 1)->endOfMonth()],
        };
    }
}
