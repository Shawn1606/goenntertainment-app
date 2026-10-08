<?php

namespace App\Support\TestPhase;

use App\Models\Booking;
use App\Models\Group;
use App\Models\Offer;
use App\Models\User;
use App\Support\Club;
use App\Support\Format;
use App\Support\Wallet;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Gemeinsame Ideen der Testphase - alles, was mehrere Konten betrifft:
 *
 * - **Partner-Wunschliste (45):** Firmen vorschlagen, die GÖ4Fun ansprechen
 *   soll; Stimmen von Platinum-Mitgliedern zaehlen doppelt.
 * - **Kosten teilen (62):** Wer fuer die Gruppe mit Credits gebucht hat, bittet
 *   die anderen um ihren Anteil; die zahlen ihn in Credits zurueck.
 * - **Abstimmung ueber Angebote (64):** In einer Gruppe 2-3 Angebote zur Wahl
 *   stellen, jede:r hat eine Stimme, das Ergebnis bucht man mit einem Tipp.
 *
 * Wie alles in der Testphase nur fuer Admins sichtbar - zum Ausprobieren mit
 * zwei Admin-Konten in derselben Gruppe.
 */
final class Community
{
    /* ------------------------------------------------------- Wunschliste */

    /** @return list<array<string, mixed>> */
    public static function wishes(User $user): array
    {
        $votes = DB::table('partner_wish_votes')->selectRaw('wish_id, SUM(weight) as score, COUNT(*) as voters')->groupBy('wish_id')->get()->keyBy('wish_id');
        $mine = DB::table('partner_wish_votes')->where('user_id', $user->getKey())->pluck('wish_id')->flip();

        return DB::table('partner_wishes')->orderByDesc('id')->limit(50)->get()
            ->map(fn ($w) => [
                'id' => (int) $w->id,
                'name' => $w->name,
                'note' => $w->note,
                'score' => (int) ($votes->get($w->id)->score ?? 0),
                'voters' => (int) ($votes->get($w->id)->voters ?? 0),
                'voted' => $mine->has($w->id),
                'mine' => (int) $w->created_by === (int) $user->getKey(),
                'created_at' => Format::iso($w->created_at ? \Illuminate\Support\Carbon::parse($w->created_at) : null),
            ])
            ->sortByDesc('score')
            ->values()
            ->all();
    }

    public static function addWish(User $user, string $name, ?string $note): void
    {
        $name = trim($name);
        if (DB::table('partner_wishes')->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])->exists()) {
            throw ValidationException::withMessages(['name' => ['Den gibt es schon auf der Liste – stimm einfach dafür.']]);
        }
        DB::transaction(function () use ($user, $name, $note) {
            $id = DB::table('partner_wishes')->insertGetId([
                'name' => $name,
                'note' => $note !== null ? (trim($note) ?: null) : null,
                'created_by' => $user->getKey(),
                'created_at' => now(),
            ]);
            self::vote($user, $id);
        });
    }

    /** Stimme setzen oder zuruecknehmen. Platinum zaehlt doppelt. */
    public static function vote(User $user, int $wishId): void
    {
        abort_unless(DB::table('partner_wishes')->where('id', $wishId)->exists(), 404);
        $existing = DB::table('partner_wish_votes')->where('wish_id', $wishId)->where('user_id', $user->getKey());
        if ($existing->exists()) {
            $existing->delete();

            return;
        }
        DB::table('partner_wish_votes')->insert([
            'wish_id' => $wishId,
            'user_id' => $user->getKey(),
            'weight' => Club::plan($user->club_plan)['key'] === 'platinum' ? 2 : 1,
            'created_at' => now(),
        ]);
    }

    /* ------------------------------------------------------ Kosten teilen */

    /** @return array{shareable: list<array<string, mixed>>, owed_to_me: list<array<string, mixed>>, i_owe: list<array<string, mixed>>} */
    public static function shares(User $user): array
    {
        $uid = $user->getKey();
        $shared = DB::table('booking_shares')->pluck('booking_id')->flip();

        $shareable = Booking::with('group.members:id,name')
            ->where('user_id', $uid)
            ->where('pay_method', 'credits')
            ->whereNotNull('group_id')
            ->where('status', '!=', 'cancelled')
            ->where('total_credits', '>', 0)
            ->orderByDesc('id')
            ->limit(10)
            ->get()
            ->reject(fn (Booking $b) => $shared->has($b->id))
            ->map(fn (Booking $b) => [
                'booking_id' => $b->id,
                'offer_title' => $b->offer_title,
                'people' => $b->people,
                'total_credits' => $b->total_credits,
                'share_credits' => self::shareCredits($b),
                'members' => $b->group?->members->where('id', '!=', $uid)->map(fn ($m) => ['id' => $m->id, 'name' => $m->name])->values()->all() ?? [],
            ])
            ->values()
            ->all();

        $row = fn ($s, string $otherName) => [
            'id' => (int) $s->id,
            'booking_id' => (int) $s->booking_id,
            'offer_title' => $s->offer_title,
            'credits' => (int) $s->credits,
            'status' => $s->status,
            'other' => $otherName,
            'created_at' => Format::iso(\Illuminate\Support\Carbon::parse($s->created_at)),
        ];

        $owed = DB::table('booking_shares')
            ->join('bookings', 'bookings.id', '=', 'booking_shares.booking_id')
            ->join('users', 'users.id', '=', 'booking_shares.debtor_id')
            ->where('booking_shares.creditor_id', $uid)
            ->orderByDesc('booking_shares.id')->limit(20)
            ->get(['booking_shares.*', 'bookings.offer_title', 'users.name as other_name'])
            ->map(fn ($s) => $row($s, $s->other_name))->all();

        $iOwe = DB::table('booking_shares')
            ->join('bookings', 'bookings.id', '=', 'booking_shares.booking_id')
            ->join('users', 'users.id', '=', 'booking_shares.creditor_id')
            ->where('booking_shares.debtor_id', $uid)
            ->orderByRaw("CASE WHEN booking_shares.status = 'pending' THEN 0 ELSE 1 END")
            ->orderByDesc('booking_shares.id')->limit(20)
            ->get(['booking_shares.*', 'bookings.offer_title', 'users.name as other_name'])
            ->map(fn ($s) => $row($s, $s->other_name))->all();

        return ['shareable' => $shareable, 'owed_to_me' => $owed, 'i_owe' => $iOwe];
    }

    /** Anteil pro Person: Gesamtpreis durch Personenzahl, aufgerundet. */
    public static function shareCredits(Booking $booking): int
    {
        return (int) ceil($booking->total_credits / max(1, $booking->people));
    }

    /** @param  list<int>  $userIds */
    public static function requestShares(User $user, int $bookingId, array $userIds): int
    {
        $booking = Booking::with('group')->where('user_id', $user->getKey())->find($bookingId);
        if ($booking === null || $booking->pay_method !== 'credits' || $booking->group === null || $booking->status === 'cancelled') {
            throw ValidationException::withMessages(['booking_id' => ['Teilen geht bei eigenen Gruppenbuchungen, die mit Credits bezahlt sind.']]);
        }

        $members = DB::table('group_members')->where('group_id', $booking->group_id)->pluck('user_id')->map(fn ($id) => (int) $id)->all();
        $targets = array_values(array_unique(array_filter($userIds, fn ($id) => $id !== (int) $user->getKey() && in_array($id, $members, true))));
        if ($targets === []) {
            throw ValidationException::withMessages(['user_ids' => ['Wähle mindestens eine Person aus der Gruppe.']]);
        }
        if (count($targets) >= $booking->people) {
            throw ValidationException::withMessages(['user_ids' => ["Die Buchung ist für {$booking->people} Personen – dein eigener Anteil bleibt bei dir."]]);
        }

        $credits = self::shareCredits($booking);
        $created = 0;
        foreach ($targets as $debtor) {
            try {
                DB::table('booking_shares')->insert([
                    'booking_id' => $booking->getKey(),
                    'debtor_id' => $debtor,
                    'creditor_id' => $user->getKey(),
                    'credits' => $credits,
                    'status' => 'pending',
                    'created_at' => now(),
                ]);
                $created++;
            } catch (UniqueConstraintViolationException) {
                // schon angefragt
            }
        }

        return $created;
    }

    public static function payShare(User $user, int $shareId): int
    {
        return DB::transaction(function () use ($user, $shareId) {
            $share = DB::table('booking_shares')->where('id', $shareId)->where('debtor_id', $user->getKey())->lockForUpdate()->first();
            if ($share === null || $share->status !== 'pending') {
                throw ValidationException::withMessages(['share' => ['Diesen Anteil gibt es nicht (mehr) zu zahlen.']]);
            }
            $booking = Booking::find($share->booking_id);
            $creditor = User::find($share->creditor_id);
            abort_if($booking === null || $creditor === null, 404);

            Wallet::debit($user, (int) $share->credits, 'share', "Anteil an {$booking->offer_title} für {$creditor->name}");
            Wallet::credit($creditor, (int) $share->credits, 'share', "Anteil von {$user->name} für {$booking->offer_title}");
            DB::table('booking_shares')->where('id', $shareId)->update(['status' => 'paid', 'settled_at' => now()]);

            return (int) $share->credits;
        });
    }

    public static function declineShare(User $user, int $shareId): void
    {
        $updated = DB::table('booking_shares')
            ->where('id', $shareId)->where('debtor_id', $user->getKey())->where('status', 'pending')
            ->update(['status' => 'declined', 'settled_at' => now()]);
        if ($updated === 0) {
            throw ValidationException::withMessages(['share' => ['Diesen Anteil gibt es nicht (mehr).']]);
        }
    }

    /* -------------------------------------------------------- Abstimmung */

    /** @return list<array<string, mixed>> */
    public static function polls(User $user): array
    {
        $groupIds = DB::table('group_members')->where('user_id', $user->getKey())->pluck('group_id');
        $polls = DB::table('group_polls')
            ->join('friend_groups', 'friend_groups.id', '=', 'group_polls.group_id')
            ->whereIn('group_polls.group_id', $groupIds)
            ->orderByRaw('CASE WHEN group_polls.closed_at IS NULL THEN 0 ELSE 1 END')
            ->orderByDesc('group_polls.id')
            ->limit(10)
            ->get(['group_polls.*', 'friend_groups.name as group_name', 'friend_groups.owner_id']);

        $options = DB::table('group_poll_options')->whereIn('poll_id', $polls->pluck('id'))->orderBy('id')->get()->groupBy('poll_id');
        $votes = DB::table('group_poll_votes')->whereIn('poll_id', $polls->pluck('id'))->get();
        $members = DB::table('group_members')->whereIn('group_id', $polls->pluck('group_id'))->selectRaw('group_id, COUNT(*) as n')->groupBy('group_id')->pluck('n', 'group_id');

        return $polls->map(function ($p) use ($options, $votes, $members, $user) {
            $counts = $votes->where('poll_id', $p->id)->countBy('option_id');
            $myVote = $votes->where('poll_id', $p->id)->firstWhere('user_id', $user->getKey());
            $opts = ($options->get($p->id) ?? collect())->map(fn ($o) => [
                'id' => (int) $o->id,
                'offer_id' => $o->offer_id ? (int) $o->offer_id : null,
                'offer_title' => $o->offer_title,
                'day' => $o->day,
                'votes' => (int) ($counts->get($o->id) ?? 0),
            ])->values();
            $top = $opts->sortByDesc('votes')->first();

            return [
                'id' => (int) $p->id,
                'group_id' => (int) $p->group_id,
                'group_name' => $p->group_name,
                'title' => $p->title,
                'closed' => $p->closed_at !== null,
                'can_close' => in_array((int) $user->getKey(), [(int) $p->created_by, (int) $p->owner_id], true),
                'members' => (int) ($members->get($p->group_id) ?? 0),
                'voted' => $votes->where('poll_id', $p->id)->count(),
                'my_option_id' => $myVote ? (int) $myVote->option_id : null,
                'winner_option_id' => $top && $top['votes'] > 0 ? $top['id'] : null,
                'options' => $opts->all(),
            ];
        })->all();
    }

    /** @param  list<array{offer_id: int, day?: string|null}>  $options */
    public static function createPoll(User $user, int $groupId, string $title, array $options): int
    {
        $group = Group::find($groupId);
        if ($group === null || ! $group->hasMember($user->getKey())) {
            throw ValidationException::withMessages(['group_id' => ['Du bist nicht in dieser Gruppe.']]);
        }

        $offers = Offer::where('is_active', true)->whereIn('id', array_column($options, 'offer_id'))->get()->keyBy('id');
        if (count($options) < 2 || count($options) > 3 || $offers->count() !== count(array_unique(array_column($options, 'offer_id')))) {
            throw ValidationException::withMessages(['options' => ['Wähle 2 oder 3 verschiedene, aktive Angebote.']]);
        }

        return DB::transaction(function () use ($user, $groupId, $title, $options, $offers) {
            $pollId = DB::table('group_polls')->insertGetId([
                'group_id' => $groupId,
                'created_by' => $user->getKey(),
                'title' => trim($title) ?: 'Was machen wir?',
                'created_at' => now(),
            ]);
            foreach ($options as $o) {
                DB::table('group_poll_options')->insert([
                    'poll_id' => $pollId,
                    'offer_id' => $o['offer_id'],
                    'offer_title' => $offers[$o['offer_id']]->title,
                    'day' => $o['day'] ?? null,
                ]);
            }

            return $pollId;
        });
    }

    public static function votePoll(User $user, int $pollId, int $optionId): void
    {
        $poll = DB::table('group_polls')->find($pollId);
        abort_if($poll === null, 404);
        $group = Group::find($poll->group_id);
        if ($group === null || ! $group->hasMember($user->getKey())) {
            abort(404);
        }
        if ($poll->closed_at !== null) {
            throw ValidationException::withMessages(['poll' => ['Die Abstimmung ist schon beendet.']]);
        }
        if (! DB::table('group_poll_options')->where('id', $optionId)->where('poll_id', $pollId)->exists()) {
            throw ValidationException::withMessages(['option_id' => ['Diese Antwort gibt es nicht.']]);
        }

        DB::table('group_poll_votes')->updateOrInsert(
            ['poll_id' => $pollId, 'user_id' => $user->getKey()],
            ['option_id' => $optionId, 'created_at' => now()],
        );
    }

    public static function closePoll(User $user, int $pollId): void
    {
        $poll = DB::table('group_polls')->join('friend_groups', 'friend_groups.id', '=', 'group_polls.group_id')
            ->where('group_polls.id', $pollId)->first(['group_polls.*', 'friend_groups.owner_id']);
        abort_if($poll === null, 404);
        if (! in_array((int) $user->getKey(), [(int) $poll->created_by, (int) $poll->owner_id], true)) {
            throw ValidationException::withMessages(['poll' => ['Beenden kann nur, wer die Abstimmung gestartet hat, oder wem die Gruppe gehört.']]);
        }
        DB::table('group_polls')->where('id', $pollId)->update(['closed_at' => now()]);
    }

    /** Gruppen des Kontos - fuer das Formular „Abstimmung starten". */
    public static function myGroups(User $user): array
    {
        return Group::whereIn('id', DB::table('group_members')->where('user_id', $user->getKey())->pluck('group_id'))
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn ($g) => ['id' => $g->id, 'name' => $g->name])
            ->all();
    }
}
