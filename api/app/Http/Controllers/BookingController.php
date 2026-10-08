<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\Group;
use App\Models\Offer;
use App\Models\Partner;
use App\Support\BookingCalendar;
use App\Support\Bookings;
use App\Support\BusinessDay;
use App\Support\TestPhase\TestPhase;
use App\Support\Wallet;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Die eigenen Buchungen: anlegen, ansehen, stornieren, am Aufkleber einloesen.
 *
 * Fremde Buchungen gibt es fuer niemanden - wer eine ID raet, bekommt 404.
 */
class BookingController extends Controller
{
    private const RELATIONS = ['partner', 'offer', 'group'];

    /** GET /api/bookings - offene zuerst, dann der Rest, neueste oben. */
    public function index(Request $request): JsonResponse
    {
        $bookings = Booking::with(self::RELATIONS)
            ->withFeedbackGiven()
            ->where('user_id', $request->user()->getKey())
            ->orderByRaw("CASE WHEN status = 'confirmed' AND valid_until > ? THEN 0 ELSE 1 END", [now()])
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        return response()->json(['data' => BookingResource::collection($bookings)]);
    }

    /** POST /api/bookings */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'offer_id' => ['required', 'integer'],
            'people' => ['required', 'integer', 'min:1', 'max:'.Bookings::MAX_PEOPLE],
            'pay_method' => ['required', Rule::in(Bookings::PAY_METHODS)],
            'group_id' => ['nullable', 'integer'],
            // „Heute" in Ortszeit, nicht in der Zeitzone des Servers (BusinessDay).
            'preferred_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:'.BusinessDay::today()],
        ], [
            'offer_id.*' => 'Welches Angebot möchtest du buchen?',
            'people.*' => 'Bitte gib an, wie viele ihr seid.',
            'pay_method.*' => 'Unbekannte Zahlart.',
            'preferred_date.*' => 'Das Wunschdatum liegt in der Vergangenheit.',
        ]);

        $offer = Offer::with('partner')->find($data['offer_id']);
        if ($offer === null) {
            throw ValidationException::withMessages(['offer_id' => ['Dieses Angebot gibt es nicht mehr.']]);
        }

        $group = isset($data['group_id']) ? Group::find($data['group_id']) : null;
        if (isset($data['group_id']) && $group === null) {
            throw ValidationException::withMessages(['group_id' => ['Diese Gruppe gibt es nicht.']]);
        }

        $booking = Bookings::create(
            $request->user(),
            $offer,
            (int) $data['people'],
            $data['pay_method'],
            $group,
            $data['preferred_date'] ?? null,
        );

        $booking->load(self::RELATIONS);

        return response()->json([
            'data' => new BookingResource($booking),
            'credits_balance' => (int) $request->user()->credits_balance,
        ], 201);
    }

    /** GET /api/bookings/{id} */
    public function show(Request $request, int $id): JsonResponse
    {
        return response()->json(['data' => new BookingResource($this->own($request, $id))]);
    }

    /** POST /api/bookings/{id}/cancel */
    public function cancel(Request $request, int $id): JsonResponse
    {
        $booking = Bookings::cancel($this->own($request, $id));
        $booking->load(self::RELATIONS);

        return response()->json([
            'data' => new BookingResource($booking),
            'credits_balance' => (int) $request->user()->fresh()->credits_balance,
        ]);
    }

    /**
     * POST /api/bookings/{id}/redeem - selbst einloesen, am Aufkleber.
     *
     * Der Token des Aufklebers ist der Nachweis, dass man vor Ort ist. Ohne ihn
     * koennte man die Buchung vom Sofa aus „verbrauchen" - fuer den Partner saehe
     * das aus wie ein Besuch, den es nie gab.
     */
    public function redeem(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'max:200']], [
            'token.*' => 'Scanne dafür den Aufkleber beim Partner.',
        ]);

        $booking = $this->own($request, $id);
        $partner = Partner::where('checkin_token', CheckinController::tokenFrom($data['token']))->first();

        if ($partner === null || $partner->getKey() !== $booking->partner_id) {
            throw ValidationException::withMessages(['token' => ['Dieser Aufkleber gehört zu einem anderen Partner.']]);
        }

        $booking = Bookings::redeem($booking, $request->user());
        $booking->load(self::RELATIONS);

        return response()->json(['data' => new BookingResource($booking)]);
    }

    /** Testphase: So viele Credits bringt eine Rueckmeldung an den Partner. */
    public const FEEDBACK_REWARD = 10;

    /**
     * GET /api/bookings/{id}/calendar.ics?sig=… - ohne Token, signiert
     * (App\Support\BookingCalendar). Der Kalender des Handys oeffnet ihn selbst.
     */
    public function calendar(Request $request, int $id): Response
    {
        abort_unless(BookingCalendar::verify($id, (string) $request->query('sig', '')), 404);
        $booking = Booking::with('partner')->find($id);
        abort_if($booking === null, 404);

        return response(BookingCalendar::ics($booking), 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => 'inline; filename="goe4fun-buchung-'.$id.'.ics"',
            'Cache-Control' => 'private, max-age=0',
        ]);
    }

    /** GET /api/offers/{offer}/availability?date=Y-m-d - freie Plaetze an einem Tag (Kontingent). */
    public function availability(Request $request, Offer $offer): JsonResponse
    {
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d']], ['date.*' => 'Welcher Tag?']);

        return response()->json(['data' => Bookings::availability($offer, $request->user(), $data['date'])]);
    }

    /**
     * POST /api/bookings/{id}/feedback {rating, comment?} - Testphase: private
     * Rueckmeldung an den Partner nach dem Einloesen, einmal je Buchung.
     */
    public function feedback(Request $request, int $id): JsonResponse
    {
        abort_unless(TestPhase::enabledFor($request->user()), 403, 'Rückmeldungen gibt es gerade nur in der Testphase.');

        $data = $request->validate([
            'rating' => ['required', 'integer', 'between:1,5'],
            'comment' => ['nullable', 'string', 'max:500'],
        ], ['rating.*' => 'Gib 1 bis 5 Sterne.', 'comment.max' => 'Höchstens 500 Zeichen.']);

        $booking = $this->own($request, $id);
        if ($booking->status !== 'redeemed') {
            throw ValidationException::withMessages(['booking' => ['Eine Rückmeldung geht, sobald du die Buchung eingelöst hast.']]);
        }

        $user = $request->user();
        DB::transaction(function () use ($booking, $user, $data) {
            try {
                DB::transaction(fn () => DB::table('booking_feedback')->insert([
                    'booking_id' => $booking->getKey(),
                    'user_id' => $user->getKey(),
                    'partner_id' => $booking->partner_id,
                    'rating' => (int) $data['rating'],
                    'comment' => isset($data['comment']) ? trim($data['comment']) ?: null : null,
                    'created_at' => now(),
                ]));
            } catch (UniqueConstraintViolationException) {
                throw ValidationException::withMessages(['booking' => ['Für diese Buchung hast du schon eine Rückmeldung gegeben.']]);
            }
            Wallet::credit($user, self::FEEDBACK_REWARD, 'feedback', "Rückmeldung an {$booking->partner_name}");
        });

        $booking->load(self::RELATIONS);

        return response()->json([
            'data' => new BookingResource($booking),
            'credits' => self::FEEDBACK_REWARD,
            'credits_balance' => (int) $user->fresh()->credits_balance,
        ]);
    }

    private function own(Request $request, int $id): Booking
    {
        $booking = Booking::with(self::RELATIONS)
            ->where('user_id', $request->user()->getKey())
            ->find($id);

        abort_if($booking === null, 404, 'Diese Buchung gibt es nicht.');

        return $booking;
    }
}
