<?php

namespace App\Http\Controllers;

use App\Http\Resources\BookingResource;
use App\Models\Booking;
use App\Models\Partner;
use App\Support\Checkins;
use App\Support\Pass;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Check-in von der KUNDEN-Seite: Handy an den NFC-Aufkleber halten oder dessen
 * QR-Code scannen. Dazu der eigene Pass fuer den umgekehrten Weg (Partner scannt).
 *
 * ## Was auf dem Aufkleber steht
 *
 * Eine Adresse wie `https://goe4fun.de/c/<token>` - dieselbe fuer NFC und QR.
 * Die App liest daraus den Token (`tokenFrom`); ein nackter Token geht auch.
 * Der Token ist 32 Zeichen Zufall; wer ihn nicht vom Aufkleber hat, raet ihn nicht.
 *
 * ## Warum der Standort
 *
 * Ein Aufkleber laesst sich abfotografieren. Damit das Foto zu Hause keine
 * Stempel bringt, muss das Handy in der Naehe des Partners sein
 * (`club.checkin_radius_m`). Ohne Standortfreigabe gibt es eine klare Meldung -
 * und den anderen Weg: den Pass beim Partner vorzeigen.
 */
class CheckinController extends Controller
{
    /** POST /api/checkins {token, method, lat?, lng?} */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string', 'max:200'],
            'method' => ['required', Rule::in(['nfc', 'qr'])],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
        ], [
            'token.*' => 'Dieser Code gehört nicht zu GÖ4Fun.',
            'method.*' => 'Unbekannte Art des Scans.',
        ]);

        $partner = Partner::active()->where('checkin_token', self::tokenFrom($data['token']))->first();
        if ($partner === null) {
            throw ValidationException::withMessages(['token' => ['Diesen Aufkleber kennen wir nicht. Frag beim Partner nach dem GÖ4Fun-Code.']]);
        }

        $this->assertNearby($partner, $data['lat'] ?? null, $data['lng'] ?? null);

        $user = $request->user();
        $result = Checkins::record($user, $partner, $data['method']);

        return response()->json(['data' => $this->result($request, $partner, $result)], 201);
    }

    /** GET /api/pass - der QR-Code, den der Partner scannt. Alle 60 s frisch holen. */
    public function pass(Request $request): JsonResponse
    {
        $offline = Pass::issueOffline($request->user());

        return response()->json(['data' => Pass::issue($request->user()) + [
            'offline_token' => $offline['token'],
            'offline_expires_at' => $offline['expires_at'],
        ]]);
    }

    /** GET /api/stamps - die Stempelkarte. */
    public function stamps(Request $request): JsonResponse
    {
        return response()->json(['data' => Checkins::card($request->user())]);
    }

    /**
     * Den Token aus dem, was der Scanner liefert: eine Adresse mit `/c/<token>`,
     * ein App-Link `goenntertainmentapp://checkin/<token>` oder der Token selbst.
     */
    public static function tokenFrom(string $scanned): string
    {
        $value = trim($scanned);
        if (preg_match('#(?:/c/|checkin/)([A-Za-z0-9]{16,40})#', $value, $m) === 1) {
            return $m[1];
        }

        return preg_replace('/[^A-Za-z0-9]/', '', $value) ?? '';
    }

    private function assertNearby(Partner $partner, mixed $lat, mixed $lng): void
    {
        $radius = (int) config('club.checkin_radius_m');
        if ($radius <= 0 || $partner->lat === null || $partner->lng === null) {
            return;
        }

        if ($lat === null || $lng === null) {
            throw ValidationException::withMessages(['location' => ['Für den Stempel brauchen wir kurz deinen Standort – oder zeig beim Partner deinen Pass.']]);
        }

        $distance = Checkins::distanceMeters((float) $lat, (float) $lng, $partner->lat, $partner->lng);
        if ($distance > $radius) {
            throw ValidationException::withMessages(['location' => ["Du scheinst nicht bei {$partner->name} zu sein. Stempel gibt es direkt vor Ort."]]);
        }
    }

    /** Antwort nach einem Check-in - dieselbe fuer beide Wege. */
    public static function result(Request $request, Partner $partner, array $result): array
    {
        $user = $result['checkin']->user ?? $request->user();

        $open = Booking::with(['partner', 'offer', 'group'])
            ->open()
            ->where('user_id', $result['checkin']->user_id)
            ->where('partner_id', $partner->getKey())
            ->orderBy('valid_until')
            ->get();

        return [
            'partner' => ['id' => $partner->id, 'name' => $partner->name],
            'stamped' => $result['stamped'],
            // Testphase: erster Besuch bei diesem Partner = doppelter Stempel.
            'bonus_stamp' => $result['bonus_stamp'] ?? false,
            'reward_credits' => $result['reward_credits'],
            'stamps' => Checkins::card($user),
            'credits' => (int) $user->fresh()->credits_balance,
            'open_bookings' => BookingResource::collection($open)->toArray($request),
        ];
    }
}
