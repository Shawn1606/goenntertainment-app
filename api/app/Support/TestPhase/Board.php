<?php

namespace App\Support\TestPhase;

use App\Models\Interest;
use App\Models\Partner;
use App\Models\TestphaseChallenge;
use App\Models\User;
use App\Support\Club;
use App\Support\Format;
use App\Support\Wallet;
use Carbon\CarbonInterface;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Alles, was der Admin-Bildschirm „Test" zeigt, in einem Stand - und das
 * Abholen von Belohnungen.
 *
 * Jede Belohnung (Challenge, Bingo-Reihe, volles Bingo, Serien-Meilenstein)
 * hat einen Schluessel und einen Zeitraum. Abholen heisst: Stand neu rechnen,
 * pruefen, ob genau diese Belohnung jetzt abholbar ist, sie in
 * `testphase_claims` eintragen (eindeutig je Konto/Schluessel/Zeitraum) und die
 * Credits gutschreiben (`challenge`). Was die App schickt, ist nur der
 * Schluessel - ob es etwas gibt, entscheidet allein der Server.
 */
final class Board
{
    /** Challenges mit Wahl: so viele darf man je Zeitraum auswaehlen. */
    public const CHOICE_LIMIT = 3;

    /** @return array<string, mixed> */
    public static function state(User $user): array
    {
        return self::build($user)['state'];
    }

    /**
     * @return array{credits: int, state: array<string, mixed>}
     */
    public static function claim(User $user, string $key): array
    {
        return DB::transaction(function () use ($user, $key) {
            User::whereKey($user->getKey())->lockForUpdate()->value('id');
            $item = self::build($user)['claimables'][$key] ?? null;

            if ($item === null || ! $item['claimable']) {
                throw ValidationException::withMessages(['key' => ['Diese Belohnung gibt es gerade nicht abzuholen.']]);
            }

            try {
                DB::transaction(fn () => DB::table('testphase_claims')->insert([
                    'user_id' => $user->getKey(),
                    'key' => $key,
                    'period' => $item['period'],
                    'credits' => $item['reward'],
                    'created_at' => now(),
                ]));
            } catch (UniqueConstraintViolationException) {
                throw ValidationException::withMessages(['key' => ['Schon abgeholt.']]);
            }

            if ($item['reward'] > 0) {
                Wallet::credit($user, $item['reward'], 'challenge', $item['label'].' – '.Format::credits($item['reward']).' Credits');
            }

            return ['credits' => $item['reward'], 'state' => self::state($user)];
        });
    }

    /**
     * @return array{state: array<string, mixed>, claimables: array<string, array{period: string, reward: int, claimable: bool, label: string}>}
     */
    private static function build(User $user): array
    {
        $now = now();
        $claimed = DB::table('testphase_claims')
            ->where('user_id', $user->getKey())
            ->get(['key', 'period'])
            ->mapWithKeys(fn ($c) => [$c->key.'|'.$c->period => true])
            ->all();
        $claimables = [];

        $claim = function (string $key, string $period, int $reward, bool $done, string $label) use (&$claimables, $claimed): array {
            $isClaimed = isset($claimed[$key.'|'.$period]);
            $entry = ['key' => $key, 'period' => $period, 'reward' => $reward, 'claimed' => $isClaimed, 'claimable' => $done && ! $isClaimed, 'label' => $label];
            $claimables[$key] = $entry;

            return $entry;
        };

        // Challenges
        $planKey = Club::plan($user->club_plan)['key'];
        $chosen = DB::table('testphase_choices')
            ->where('user_id', $user->getKey())
            ->get(['challenge_id', 'period'])
            ->mapWithKeys(fn ($c) => [$c->challenge_id.'|'.$c->period => true])
            ->all();
        $challenges = [];
        foreach (TestphaseChallenge::with(['partner:id,name', 'interest:id,name'])->where('is_active', true)->orderBy('sort')->orderBy('id')->get() as $c) {
            [$from, $to, $period, $periodLabel] = self::window($c, $now);
            $status = $now->lessThan($from) ? 'upcoming' : ($now->greaterThan($to) ? 'ended' : 'running');
            $progress = $status === 'upcoming' ? 0 : Progress::count($user, $c->metric, $from, $to, [
                'partner_id' => $c->partner_id,
                'interest_id' => $c->interest_id,
                'match_text' => $c->match_text,
                'offer_kind' => $c->offer_kind,
            ]);
            $allowed = empty($c->plans) || in_array($planKey, $c->plans, true);
            // Challenges mit Wahl zaehlen nur, wenn man sie ausgewaehlt hat.
            $isChosen = isset($chosen[$c->id.'|'.$period]);
            $choiceOk = ! $c->is_choice || $isChosen;
            $done = $progress >= $c->target;
            $entry = $claim('challenge:'.$c->id, $period, $c->reward_credits, $allowed && $choiceOk && $done && $status !== 'upcoming', 'Challenge geschafft: '.$c->title);
            // Geheime Challenges zeigen sich erst, wenn sie geschafft sind.
            $revealed = ! $c->is_secret || $done || $entry['claimed'];

            $challenges[] = [
                'id' => $c->id,
                'type' => $c->type,
                'title' => $revealed ? $c->title : 'Geheime Challenge',
                'description' => $revealed ? $c->description : 'Was zu tun ist, siehst du erst, wenn du es geschafft hast.',
                'is_secret' => (bool) $c->is_secret,
                'revealed' => $revealed,
                'is_choice' => (bool) $c->is_choice,
                'chosen' => $isChosen,
                'metric' => $c->metric,
                'target' => $c->target,
                'progress' => $progress,
                'reward_credits' => $c->reward_credits,
                'period' => $c->period,
                'period_label' => $periodLabel,
                'starts_at' => Format::iso($from),
                'ends_at' => Format::iso($to),
                'status' => $status,
                'partner' => $revealed && $c->partner ? ['id' => $c->partner->id, 'name' => $c->partner->name] : null,
                'interest' => $revealed && $c->interest ? ['id' => $c->interest->id, 'name' => $c->interest->name] : null,
                'match_text' => $revealed ? $c->match_text : null,
                'offer_kind' => $revealed ? $c->offer_kind : null,
                'plans' => $c->plans,
                'allowed' => $allowed,
                'claim' => $entry,
            ];
        }

        // Stadt-Bingo
        $board = Bingo::board($user, $now);
        $lines = [];
        foreach (Bingo::LINES as $n => $cells) {
            $done = in_array($n, $board['done_lines'], true);
            $lines[] = ['index' => $n, 'cells' => $cells, 'done' => $done]
                + ['claim' => $claim('bingo:line:'.$n, $board['period'], Bingo::LINE_REWARD, $done, 'Stadt-Bingo: Reihe voll')];
        }
        $bingo = [
            'period' => $board['period'],
            'period_label' => self::monthLabel($now),
            'cells' => $board['cells'],
            'lines' => $lines,
            'line_reward' => Bingo::LINE_REWARD,
            'full_reward' => Bingo::FULL_REWARD,
            'full' => ['done' => $board['full'], 'claim' => $claim('bingo:full', $board['period'], Bingo::FULL_REWARD, $board['full'], 'Stadt-Bingo: volles Feld')],
        ];

        // Check-in-Serie
        $streak = Streak::state($user, $now);
        $milestones = [];
        foreach (Streak::MILESTONES as $weeks => $reward) {
            $milestones[] = ['weeks' => $weeks, 'reward' => $reward]
                + ['claim' => $claim('streak:'.$weeks, $streak['start_week'] ?? 'none', $reward, $streak['weeks'] >= $weeks, "Check-in-Serie: {$weeks} Wochen")];
        }

        // Treuestufen: je Stufe einmal pro Kalenderjahr ein Bonus.
        $loyalty = Loyalty::state($user, $now);
        $levels = [];
        foreach (Loyalty::LEVELS as $key => [$name, $visits, $reward]) {
            $levels[] = ['key' => $key, 'name' => $name, 'visits' => $visits, 'reward' => $reward]
                + ['claim' => $claim('loyalty:'.$key, (string) $now->year, $reward, $loyalty['visits'] >= $visits, "Treuestufe {$name}")];
        }

        $happy = Club::rules()['testphase']['happyHour'] ?? null;

        return [
            'state' => [
                'plan' => $planKey,
                'choice_limit' => self::CHOICE_LIMIT,
                'challenges' => $challenges,
                'loyalty' => $loyalty + ['levels' => $levels],
                'album' => Album::state($user),
                'wishes' => Community::wishes($user),
                'shares' => Community::shares($user),
                'polls' => Community::polls($user),
                'feedback' => self::recentFeedback(),
                'happy_hour' => [
                    'weekdays' => $happy['weekdays'] ?? [],
                    'percent' => (float) ($happy['percent'][$planKey] ?? 0),
                ],
                'reserved_offers' => \App\Models\Offer::with('partner:id,name')
                    ->whereNotNull('daily_capacity')
                    ->orderBy('title')
                    ->get(['id', 'partner_id', 'title', 'daily_capacity', 'platinum_reserved'])
                    ->map(fn ($o) => ['id' => $o->id, 'title' => $o->title, 'partner' => $o->partner?->name, 'daily_capacity' => $o->daily_capacity, 'platinum_reserved' => (int) $o->platinum_reserved])
                    ->all(),
                'bingo' => $bingo,
                'streak' => $streak + ['milestones' => $milestones],
                'first_visit_bonus' => ['active' => TestPhase::enabledFor($user)],
                'options' => [
                    'partners' => Partner::orderBy('name')->get(['id', 'name'])->map(fn ($p) => ['id' => $p->id, 'name' => $p->name])->all(),
                    'interests' => Interest::orderBy('name')->get(['id', 'name'])->map(fn ($i) => ['id' => $i->id, 'name' => $i->name])->all(),
                    'types' => TestphaseChallenge::TYPES,
                    'metrics' => Progress::METRICS,
                    'groups' => Community::myGroups($user),
                    'offers' => \App\Models\Offer::with('partner:id,name')
                        ->where('is_active', true)
                        ->orderBy('title')
                        ->limit(100)
                        ->get(['id', 'partner_id', 'title'])
                        ->map(fn ($o) => ['id' => $o->id, 'title' => $o->title, 'partner' => $o->partner?->name])
                        ->all(),
                ],
            ],
            'claimables' => $claimables,
        ];
    }

    /**
     * Challenge mit Wahl aus- oder abwaehlen. Hoechstens CHOICE_LIMIT je
     * Zeitraum; eine schon abgeholte bleibt gewaehlt.
     */
    public static function toggleChoice(User $user, int $challengeId): void
    {
        $c = TestphaseChallenge::where('is_active', true)->where('is_choice', true)->find($challengeId);
        if ($c === null) {
            throw ValidationException::withMessages(['challenge_id' => ['Diese Challenge kann man nicht auswählen.']]);
        }
        [, , $period] = self::window($c, now());

        $existing = DB::table('testphase_choices')->where('user_id', $user->getKey())->where('challenge_id', $c->id)->where('period', $period);
        if ($existing->exists()) {
            $claimed = DB::table('testphase_claims')->where('user_id', $user->getKey())->where('key', 'challenge:'.$c->id)->where('period', $period)->exists();
            if ($claimed) {
                throw ValidationException::withMessages(['challenge_id' => ['Die hast du schon geschafft – sie bleibt gewählt.']]);
            }
            $existing->delete();

            return;
        }

        $count = DB::table('testphase_choices')->where('user_id', $user->getKey())->where('period', $period)->count();
        if ($count >= self::CHOICE_LIMIT) {
            throw ValidationException::withMessages(['challenge_id' => ['Du hast schon '.self::CHOICE_LIMIT.' gewählt – nimm erst eine ab.']]);
        }
        DB::table('testphase_choices')->insert([
            'user_id' => $user->getKey(),
            'challenge_id' => $c->id,
            'period' => $period,
            'created_at' => now(),
        ]);
    }

    /** Die letzten Rueckmeldungen an Partner (fuer Admins zum Mitlesen). */
    private static function recentFeedback(): array
    {
        return DB::table('booking_feedback')
            ->leftJoin('partners', 'partners.id', '=', 'booking_feedback.partner_id')
            ->leftJoin('bookings', 'bookings.id', '=', 'booking_feedback.booking_id')
            ->orderByDesc('booking_feedback.id')
            ->limit(10)
            ->get(['booking_feedback.*', 'partners.name as partner_name', 'bookings.offer_title'])
            ->map(fn ($f) => [
                'id' => (int) $f->id,
                'partner' => $f->partner_name,
                'offer_title' => $f->offer_title,
                'rating' => (int) $f->rating,
                'comment' => $f->comment,
                'created_at' => Format::iso($f->created_at ? \Illuminate\Support\Carbon::parse($f->created_at) : null),
            ])
            ->all();
    }

    /**
     * Zeitfenster einer Challenge: [von, bis, Schluessel, Anzeige].
     *
     * @return array{0: CarbonInterface, 1: CarbonInterface, 2: string, 3: string}
     */
    public static function window(TestphaseChallenge $c, CarbonInterface $now): array
    {
        if ($c->period === 'week') {
            return [$now->copy()->startOfWeek(), $now->copy()->endOfWeek(), Streak::weekKey($now), 'KW '.$now->isoWeek()];
        }
        if ($c->period === 'range' && $c->starts_at && $c->ends_at) {
            $from = $c->starts_at->copy()->startOfDay();
            $to = $c->ends_at->copy()->endOfDay();

            return [$from, $to, 'range-'.$from->format('Ymd'), $from->format('d.m.').'–'.$to->format('d.m.Y')];
        }

        return [$now->copy()->startOfMonth(), $now->copy()->endOfMonth(), $now->format('Y-m'), self::monthLabel($now)];
    }

    private static function monthLabel(CarbonInterface $at): string
    {
        $months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

        return $months[$at->month - 1].' '.$at->year;
    }
}
