<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\Checkin;
use App\Models\Partner;
use App\Models\User;
use App\Support\Bookings;
use App\Support\Checkins;
use App\Support\Format;
use App\Support\Pass;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Der Partner-Modus: Mitarbeitende eines Partners scannen den Pass eines Kunden,
 * sehen dessen offene Buchungen und loesen sie ein.
 *
 * Wer Mitarbeitende:r ist, traegt ein Admin ein (`partner_staff`). Ein Konto kann
 * zu mehreren Partnern gehoeren (Kette, Aushilfe) - dann sagt die App, fuer
 * welchen gescannt wird (`partner_id`).
 */
class PartnerStaffController extends Controller
{
    /** GET /api/partner/me - fuer welche Partner darf ich scannen? */
    public function me(Request $request): JsonResponse
    {
        $partners = $request->user()->staffPartners()->where('is_active', true)->orderBy('name')->get()
            ->map(fn (Partner $p) => ['id' => $p->id, 'name' => $p->name, 'role' => $p->pivot->role]);

        return response()->json(['data' => $partners]);
    }

    /** POST /api/partner/checkins {partner_id, pass} - Kunden-Pass gescannt. */
    public function checkin(Request $request): JsonResponse
    {
        $data = $request->validate([
            'partner_id' => ['required', 'integer'],
            'pass' => ['required', 'string', 'max:200'],
        ], [
            'partner_id.*' => 'Für welchen Partner scannst du?',
            'pass.*' => 'Das ist kein GÖ4Fun-Pass.',
        ]);

        $partner = $this->staffPartner($request, (int) $data['partner_id']);

        $customerId = Pass::verify($data['pass']);
        $customer = $customerId !== null ? User::find($customerId) : null;
        if ($customer === null) {
            throw ValidationException::withMessages(['pass' => ['Dieser Pass ist abgelaufen oder ungültig. Bitte in der App neu öffnen lassen.']]);
        }
        if ($customer->isBanned()) {
            throw ValidationException::withMessages(['pass' => ['Dieses Konto ist gesperrt.']]);
        }

        $result = Checkins::record($customer, $partner, 'pass', $request->user());
        $payload = CheckinController::result($request, $partner, $result);

        // Der Partner sieht den Vornamen - genug, um „Hallo Lena" zu sagen, nicht mehr.
        $payload['customer'] = ['first_name' => strtok((string) $customer->name, ' ') ?: $customer->name];
        unset($payload['credits']);

        return response()->json(['data' => $payload], 201);
    }

    /** GET /api/partner/bookings?partner_id= - offene Buchungen und die heute eingeloesten. */
    public function bookings(Request $request): JsonResponse
    {
        $partner = $this->staffPartner($request, (int) $request->query('partner_id'));

        $bookings = Booking::with(['partner', 'offer', 'group'])
            ->where('partner_id', $partner->getKey())
            ->where(fn ($q) => $q->where(fn ($q) => $q->where('status', 'confirmed')->where('valid_until', '>', now()))
                ->orWhere(fn ($q) => $q->where('status', 'redeemed')->where('redeemed_at', '>=', now()->startOfDay())))
            ->orderByRaw("CASE WHEN status = 'confirmed' THEN 0 ELSE 1 END")
            ->orderByDesc('id')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $bookings->map(fn (Booking $b) => (new BookingResource($b))->toArray($request) + [
                'customer' => ['first_name' => strtok((string) $b->user?->name, ' ') ?: 'Gast'],
            ]),
            'checked_in_today' => Checkin::where('partner_id', $partner->getKey())
                ->where('created_at', '>=', now()->startOfDay())->count(),
            'generated_at' => Format::iso(now()),
        ]);
    }

    /** POST /api/partner/bookings/{id}/redeem */
    public function redeem(Request $request, int $id): JsonResponse
    {
        $booking = Booking::with(['partner', 'offer', 'group'])->find($id);
        abort_if($booking === null, 404, 'Diese Buchung gibt es nicht.');
        $this->staffPartner($request, (int) $booking->partner_id);

        $booking = Bookings::redeem($booking, $request->user());

        return response()->json(['data' => new BookingResource($booking)]);
    }

    private function staffPartner(Request $request, int $partnerId): Partner
    {
        $partner = $request->user()->staffPartners()->where('partners.id', $partnerId)->first();
        // 403 statt 404: Wer im Partner-Modus ist, kennt die Partner ohnehin.
        abort_if($partner === null, 403, 'Du bist für diesen Partner nicht freigeschaltet.');

        return $partner;
    }
}
