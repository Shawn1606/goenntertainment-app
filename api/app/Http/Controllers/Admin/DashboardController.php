<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Support\BusinessDay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Die Zahlen des Marktplatzes und die Meldungen der Nutzer:innen.
 */
class DashboardController extends Controller
{
    /** Wie viele Tage der Verlauf zurueckreicht. */
    private const SERIES_DAYS = 14;

    /** GET /api/admin/stats */
    public function stats(): JsonResponse
    {
        // Tage in Ortszeit (BusinessDay), die Grenzen als Zeitpunkte in app.timezone.
        $since = BusinessDay::stored(BusinessDay::now()->subDays(self::SERIES_DAYS - 1)->startOfDay());
        $week = BusinessDay::stored(BusinessDay::now()->subDays(6)->startOfDay());

        $bookings = DB::table('bookings');

        return response()->json([
            'totals' => [
                'users' => DB::table('users')->count(),
                'partners' => DB::table('partners')->where('is_active', true)->count(),
                'offers' => DB::table('offers')->where('is_active', true)->count(),
                'bookings' => (clone $bookings)->count(),
                'open_bookings' => (clone $bookings)->where('status', 'confirmed')->where('valid_until', '>', now())->count(),
                'revenue_cents' => (int) (clone $bookings)->where('status', '<>', 'cancelled')->sum('total_cents'),
                'credits_outstanding' => (int) DB::table('users')->sum('credits_balance'),
                'members_gold' => DB::table('users')->where('club_plan', 'gold')->count(),
                'members_platinum' => DB::table('users')->where('club_plan', 'platinum')->count(),
                'checkins_week' => DB::table('checkins')->where('created_at', '>=', $week)->count(),
                'open_reports' => DB::table('content_reports')->where('status', 'open')->count(),
            ],
            'series' => [
                'days' => self::SERIES_DAYS,
                'signups' => $this->series('users', $since),
                'bookings' => $this->series('bookings', $since),
                'checkins' => $this->series('checkins', $since),
            ],
        ]);
    }

    /** GET /api/admin/bookings?status= - die letzten Buchungen. */
    public function bookings(Request $request): JsonResponse
    {
        $bookings = Booking::with(['partner', 'offer', 'group', 'user'])
            ->withFeedbackGiven()
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->orderByDesc('id')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $bookings->map(fn (Booking $b) => (new BookingResource($b))->toArray($request) + [
                'user' => $b->user ? ['id' => $b->user->id, 'name' => $b->user->name, 'email' => $b->user->email] : null,
            ]),
        ]);
    }

    /** GET /api/admin/reports?status= */
    public function reports(Request $request): JsonResponse
    {
        $status = $request->query('status', 'open');

        $rows = DB::table('content_reports as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.reporter_id')
            ->leftJoin('users as h', 'h.id', '=', 'r.handled_by')
            ->when($status !== 'all', fn ($q) => $q->where('r.status', $status))
            ->orderByDesc('r.created_at')
            ->limit(300)
            ->get(['r.*', 'u.name as reporter_name', 'h.name as handled_by_name']);

        return response()->json(['data' => $rows->map(fn ($r) => [
            'id' => $r->id,
            'target_type' => $r->target_type,
            'target_id' => $r->target_id,
            // Wie es JETZT heisst (null: inzwischen weg) - und was im Moment der Meldung da stand.
            'target' => $this->describe($r->target_type, (int) $r->target_id),
            'snapshot' => $r->snapshot === null ? null : json_decode($r->snapshot, true),
            'reason' => $r->reason,
            'note' => $r->note,
            'status' => $r->status,
            'reporter_name' => $r->reporter_name,
            'handled_by_name' => $r->handled_by_name,
            'handled_at' => $r->handled_at,
            'created_at' => $r->created_at,
        ])]);
    }

    /** PATCH /api/admin/reports/{id} {status: reviewed|dismissed|open} */
    public function updateReport(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::in(['open', 'reviewed', 'dismissed'])]]);
        $open = $data['status'] === 'open';

        $updated = DB::table('content_reports')->where('id', $id)->update([
            'status' => $data['status'],
            'handled_by' => $open ? null : $request->user()->getKey(),
            'handled_at' => $open ? null : now(),
        ]);
        abort_if($updated === 0 && ! DB::table('content_reports')->where('id', $id)->exists(), 404, 'Meldung nicht gefunden.');

        return response()->json(['message' => 'Meldung aktualisiert.']);
    }

    /** Ein Satz dazu, WAS gemeldet wurde - der Inhalt kann inzwischen weg sein. */
    private function describe(string $type, int $id): ?string
    {
        $text = match ($type) {
            'message' => DB::table('chat_messages')->where('id', $id)->value('body'),
            'user' => DB::table('users')->where('id', $id)->value('name'),
            'group' => DB::table('friend_groups')->where('id', $id)->value('name'),
            'partner' => DB::table('partners')->where('id', $id)->value('name'),
            'offer' => DB::table('offers')->where('id', $id)->value('title'),
            default => null,
        };

        return $text === null ? null : mb_substr((string) $text, 0, 200);
    }

    /**
     * Luecken-freie Tagesreihe, damit der Graph keine Loecher hat - je Kalendertag in Ortszeit.
     * Gezaehlt wird je Stunde (in app.timezone): Jede Stunde gehoert ganz zu einem Tag in
     * Goettingen, auch ueber die Zeitumstellung hinweg, und die Datenbank braucht keine
     * Zeitzonen-Tabellen.
     */
    private function series(string $table, \DateTimeInterface $since): array
    {
        $hours = DB::table($table)
            ->where('created_at', '>=', $since)
            ->selectRaw("DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00') as h, COUNT(*) as c")
            ->groupBy('h')
            ->pluck('c', 'h');

        $days = [];
        foreach ($hours as $hour => $count) {
            $day = BusinessDay::local((string) $hour)->toDateString();
            $days[$day] = ($days[$day] ?? 0) + (int) $count;
        }

        $series = [];
        $today = BusinessDay::now();
        for ($i = self::SERIES_DAYS - 1; $i >= 0; $i--) {
            $day = $today->copy()->subDays($i)->format('Y-m-d');
            $series[] = ['date' => $day, 'count' => $days[$day] ?? 0];
        }

        return $series;
    }
}
