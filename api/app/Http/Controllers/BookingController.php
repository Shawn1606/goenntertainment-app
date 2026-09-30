<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\Group;
use App\Models\Offer;
use App\Models\Partner;
use App\Support\Bookings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
            'preferred_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:today'],
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

    private function own(Request $request, int $id): Booking
    {
        $booking = Booking::with(self::RELATIONS)
            ->where('user_id', $request->user()->getKey())
            ->find($id);

        abort_if($booking === null, 404, 'Diese Buchung gibt es nicht.');

        return $booking;
    }
}
