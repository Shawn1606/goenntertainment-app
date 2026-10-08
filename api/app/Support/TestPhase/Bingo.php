<?php

namespace App\Support\TestPhase;

use App\Models\Partner;
use App\Models\User;
use App\Support\Media;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Stadt-Bingo: ein 3x3-Feld pro Monat.
 *
 * Die Mitte ist ein Joker (immer erledigt). Bis zu sechs Felder sind Partner
 * aus moeglichst verschiedenen Kategorien - erledigt mit einem Besuch in diesem
 * Monat. Der Rest sind kleine Aufgaben („Check-in vor 12 Uhr",
 * „Gruppenbuchung" ...), damit das Feld abwechslungsreich bleibt und auch mit
 * wenigen Partnern funktioniert.
 *
 * Jede volle Reihe, Spalte oder Diagonale bringt LINE_REWARD Credits, das
 * ganze Feld FULL_REWARD. Das Feld ist pro Konto und Monat fest (Zufall mit
 * festem Startwert) - wer neu laedt, bekommt dasselbe Feld.
 */
final class Bingo
{
    public const LINE_REWARD = 50;

    public const FULL_REWARD = 300;

    private const MAX_PARTNERS = 6;

    private const JOKER = 4;

    /** Reihen, Spalten, Diagonalen - Indizes im 3x3-Feld. */
    public const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

    /** Aufgaben fuer die Felder ohne Partner: Titel, Beschreibung, Symbol. */
    public const TASKS = [
        'morning' => ['Früher Vogel', 'Check-in vor 12 Uhr', 'clock'],
        'weekend' => ["Wochen\u{00AD}ende", 'Check-in am Samstag oder Sonntag', 'calendar'],
        'group_booking' => ['Gruppe', 'Eine Gruppenbuchung', 'users'],
        'credits_booking' => ['Mit Credits', 'Eine Buchung mit Credits bezahlt', 'coin'],
        'redeemed_perk' => ['Gratis-Angebot', 'Ein Gratis-Angebot eingelöst', 'gift'],
        'two_partners_day' => ['Doppelpack', 'Zwei Partner an einem Tag', 'stamp'],
        'new_partner' => ['Neuland', 'Erstbesuch bei einem Partner', 'sparkles'],
        'voucher' => ["Gutschein\u{00AD}karte", 'Eine Gutscheinkarte eingelöst', 'ticket'],
    ];

    /**
     * Das Feld dieses Monats mit Stand.
     *
     * @return array{period: string, cells: list<array<string, mixed>>, done_lines: list<int>, full: bool}
     */
    public static function board(User $user, CarbonInterface $now): array
    {
        $from = $now->copy()->startOfMonth();
        $to = $now->copy()->endOfMonth();
        $period = $now->format('Y-m');
        $seed = $user->getKey().'-'.$period;

        $fields = array_merge(self::partnerFields($seed), []);
        $taskKeys = self::seeded(array_keys(self::TASKS), $seed.'-tasks');
        foreach ($taskKeys as $key) {
            if (count($fields) >= 8) {
                break;
            }
            [$title, $hint, $icon] = self::TASKS[$key];
            $fields[] = ['kind' => 'task', 'task' => $key, 'label' => $title, 'hint' => $hint, 'icon' => $icon];
        }
        // Nach festen Kennungen mischen, nicht nach Texten: Ein geaenderter
        // Feldtitel soll das Feld mitten im Monat nicht neu anordnen.
        $fields = self::seeded($fields, $seed.'-layout', fn (array $f) => $f['kind'] === 'partner' ? 'p'.$f['partner_id'] : 't'.$f['task']);

        $visited = DB::table('stamps')
            ->where('user_id', $user->getKey())
            ->whereNotNull('partner_id')
            ->whereBetween('created_at', [$from, $to])
            ->distinct()
            ->pluck('partner_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $cells = [];
        $i = 0;
        for ($index = 0; $index < 9; $index++) {
            if ($index === self::JOKER) {
                $cells[] = ['index' => $index, 'kind' => 'joker', 'label' => 'Joker', 'hint' => 'Geschenkt', 'icon' => 'star', 'done' => true];

                continue;
            }
            $field = $fields[$i++];
            $done = $field['kind'] === 'partner'
                ? in_array($field['partner_id'], $visited, true)
                : self::taskDone($user, $field['task'], $from, $to);
            $cells[] = ['index' => $index] + $field + ['done' => $done];
        }

        $doneLines = [];
        foreach (self::LINES as $n => $line) {
            if (collect($line)->every(fn ($c) => $cells[$c]['done'])) {
                $doneLines[] = $n;
            }
        }

        return [
            'period' => $period,
            'cells' => $cells,
            'done_lines' => $doneLines,
            'full' => collect($cells)->every(fn ($c) => $c['done']),
        ];
    }

    /** Bis zu sechs aktive Partner, je Kategorie erst einer - dann der Rest. */
    private static function partnerFields(string $seed): array
    {
        $partners = self::seeded(
            Partner::where('is_active', true)->get(['id', 'name', 'interest_id', 'logo_path'])->all(),
            $seed.'-partners',
            fn (Partner $p) => (string) $p->id,
        );

        $picked = [];
        $seenInterests = [];
        foreach ($partners as $p) {
            $interest = $p->interest_id ?? 'none-'.$p->id;
            if (! isset($seenInterests[$interest])) {
                $seenInterests[$interest] = true;
                $picked[$p->id] = $p;
            }
        }
        foreach ($partners as $p) {
            $picked[$p->id] ??= $p;
        }

        return array_map(fn (Partner $p) => [
            'kind' => 'partner',
            'partner_id' => (int) $p->id,
            'label' => $p->name,
            'hint' => 'Einmal besuchen',
            'icon' => 'building',
            'logo_url' => Media::url($p->logo_path),
        ], array_slice(array_values($picked), 0, self::MAX_PARTNERS));
    }

    private static function taskDone(User $user, string $task, CarbonInterface $from, CarbonInterface $to): bool
    {
        $uid = $user->getKey();
        $stamps = fn () => DB::table('stamps')->where('user_id', $uid)->whereNotNull('partner_id')->whereBetween('created_at', [$from, $to]);
        $bookings = fn () => DB::table('bookings')->where('user_id', $uid)->where('status', '!=', 'cancelled')->whereBetween('created_at', [$from, $to]);

        return match ($task) {
            'morning' => $stamps()->pluck('created_at')->contains(fn ($at) => \Illuminate\Support\Carbon::parse($at)->hour < 12),
            'weekend' => $stamps()->pluck('created_at')->contains(fn ($at) => \Illuminate\Support\Carbon::parse($at)->isWeekend()),
            'group_booking' => $bookings()->whereNotNull('group_id')->exists(),
            'credits_booking' => $bookings()->where('pay_method', 'credits')->exists(),
            'redeemed_perk' => DB::table('bookings')
                ->join('offers', 'offers.id', '=', 'bookings.offer_id')
                ->where('bookings.user_id', $uid)
                ->where('bookings.status', 'redeemed')
                ->where('offers.kind', 'perk')
                ->whereBetween('bookings.redeemed_at', [$from, $to])
                ->exists(),
            'two_partners_day' => $stamps()
                ->select('stamp_day')
                ->groupBy('stamp_day')
                ->havingRaw('COUNT(DISTINCT partner_id) >= 2')
                ->exists(),
            'new_partner' => $stamps()->pluck('partner_id')->unique()->contains(
                fn ($pid) => ! DB::table('stamps')->where('user_id', $uid)->where('partner_id', $pid)->where('created_at', '<', $from)->exists(),
            ),
            'voucher' => DB::table('credit_transactions')->where('user_id', $uid)->where('kind', 'voucher')->whereBetween('created_at', [$from, $to])->exists(),
            default => false,
        };
    }

    /**
     * Fest gemischt: gleiche Eingabe + gleicher Startwert = gleiche Reihenfolge.
     *
     * @template T
     *
     * @param  list<T>  $items
     * @param  (callable(T): string)|null  $id
     * @return list<T>
     */
    private static function seeded(array $items, string $seed, ?callable $id = null): array
    {
        $keyed = [];
        foreach (array_values($items) as $item) {
            $keyed[] = [crc32($seed.'|'.($id ? $id($item) : (string) $item)), $item];
        }
        usort($keyed, fn ($a, $b) => $a[0] <=> $b[0]);

        return array_column($keyed, 1);
    }
}
