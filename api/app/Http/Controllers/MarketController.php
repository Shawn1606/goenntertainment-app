<?php

namespace App\Http\Controllers;

use App\Http\Resources\OfferResource;
use App\Http\Resources\PartnerResource;
use App\Models\Offer;
use App\Models\Partner;
use App\Support\Bookings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Was es gibt: Partner und ihre Angebote.
 *
 * Die Liste ist bewusst EIN Aufruf mit allen aktiven Angeboten samt Partner-Kern.
 * Eine Stadt hat wenige Dutzend davon; die App sortiert, filtert und rechnet den
 * Gruppen-Finder daraus ohne weitere Anfragen (src/domain/offer-match.ts).
 */
class MarketController extends Controller
{
    /** GET /api/offers */
    public function offers(): JsonResponse
    {
        $offers = Offer::bookable()
            ->with('partner')
            ->orderByDesc('is_featured')
            ->orderBy('sort')
            ->orderByDesc('id')
            ->get();

        return response()->json(['data' => OfferResource::collection($offers)]);
    }

    /** GET /api/offers/{offer} */
    public function offer(Offer $offer): JsonResponse
    {
        abort_unless($offer->is_active && $offer->partner?->is_active, 404, 'Dieses Angebot gibt es nicht mehr.');
        $offer->load('partner');

        return response()->json(['data' => new OfferResource($offer)]);
    }

    /** GET /api/partners */
    public function partners(): JsonResponse
    {
        $partners = Partner::active()->orderByDesc('is_featured')->orderBy('name')->get();

        return response()->json(['data' => PartnerResource::collection($partners)]);
    }

    /** GET /api/partners/{partner} - mit allen aktiven Angeboten. */
    public function partner(Partner $partner): JsonResponse
    {
        abort_unless($partner->is_active, 404, 'Diesen Partner gibt es nicht mehr.');
        $partner->load(['offers' => fn ($q) => $q->where('is_active', true)->orderBy('sort')->orderByDesc('id')]);
        $partner->offers->each->setRelation('partner', $partner);

        return response()->json(['data' => new PartnerResource($partner)]);
    }

    /**
     * POST /api/offers/{offer}/quote - Preis fuer diese Personenzahl und Zahlart.
     *
     * Die App zeigt die Vorschau schon selbst; diese Antwort ist die verbindliche
     * Zahl direkt vor dem Buchen-Knopf.
     */
    public function quote(Request $request, Offer $offer): JsonResponse
    {
        $data = $request->validate([
            'people' => ['required', 'integer', 'min:1', 'max:'.Bookings::MAX_PEOPLE],
            'pay_method' => ['required', Rule::in(Bookings::PAY_METHODS)],
        ], [
            'people.*' => 'Bitte gib an, wie viele ihr seid.',
            'pay_method.*' => 'Unbekannte Zahlart.',
        ]);

        $offer->load('partner');

        return response()->json(['data' => Bookings::quote($request->user(), $offer, (int) $data['people'], $data['pay_method'])]);
    }
}
