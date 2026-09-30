<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\OfferResource;
use App\Models\Booking;
use App\Models\Offer;
use App\Support\Uploads;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Angebote der Partner verwalten.
 *
 * Mindestens ein Preis muss stehen: Euro, Credits oder beides. Ein Angebot nur
 * mit Credits (Freigetraenk fuer 80 Credits) ist ausdruecklich erwuenscht - das
 * ist der Weg, auf dem Credits bei Partnern etwas wert sind.
 */
class OfferController extends Controller
{
    /** GET /api/admin/offers?partner_id= */
    public function index(Request $request): JsonResponse
    {
        $offers = Offer::with('partner')
            ->when($request->query('partner_id'), fn ($q, $id) => $q->where('partner_id', (int) $id))
            ->orderBy('partner_id')
            ->orderBy('sort')
            ->orderByDesc('id')
            ->get();

        return response()->json(['data' => $offers->map(fn (Offer $o) => $this->present($request, $o))]);
    }

    /** POST /api/admin/offers */
    public function store(Request $request): JsonResponse
    {
        $offer = Offer::create($this->validated($request, null));

        return response()->json(['data' => $this->present($request, $offer->load('partner'))], 201);
    }

    /** PATCH /api/admin/offers/{offer} */
    public function update(Request $request, Offer $offer): JsonResponse
    {
        $offer->update($this->validated($request, $offer));

        return response()->json(['data' => $this->present($request, $offer->load('partner'))]);
    }

    /** DELETE /api/admin/offers/{offer} - Buchungen bleiben mit Schnappschuss stehen. */
    public function destroy(Offer $offer): JsonResponse
    {
        Uploads::delete($offer->image_path);
        $offer->delete();

        return response()->json(['message' => 'Angebot gelöscht.']);
    }

    /** POST /api/admin/offers/{offer}/image {image} */
    public function image(Request $request, Offer $offer): JsonResponse
    {
        $request->validate(['image' => Uploads::rule()], ['image.*' => 'Bitte ein Bild wählen (jpg, png oder webp, höchstens 5 MB).']);

        $previous = $offer->image_path;
        $offer->forceFill(['image_path' => Uploads::store($request->file('image'), 'offers')])->save();
        Uploads::delete($previous);

        return response()->json(['data' => $this->present($request, $offer->load('partner'))]);
    }

    private function validated(Request $request, ?Offer $offer): array
    {
        $required = $offer ? 'sometimes' : 'required';

        $data = $request->validate([
            'partner_id' => [$required, 'integer', 'exists:partners,id'],
            'kind' => [$required, Rule::in(Offer::KINDS)],
            'title' => [$required, 'string', 'max:120'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'interest_id' => ['sometimes', 'nullable', 'integer', 'exists:interests,id'],
            'price_cents' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:10000000'],
            'price_credits' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000'],
            'max_discount_percent' => ['sometimes', 'nullable', 'integer', 'between:0,100'],
            'min_people' => ['sometimes', 'integer', 'min:1', 'max:500'],
            'max_people' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:500'],
            'min_age' => ['sometimes', 'nullable', 'integer', 'between:0,99'],
            'max_age' => ['sometimes', 'nullable', 'integer', 'between:0,99'],
            'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:10080'],
            'indoor' => ['sometimes', 'nullable', 'boolean'],
            'valid_days' => ['sometimes', 'integer', 'min:1', 'max:730'],
            'is_active' => ['sometimes', 'boolean'],
            'is_featured' => ['sometimes', 'boolean'],
            'sort' => ['sometimes', 'integer', 'min:0', 'max:65535'],
        ], [
            'partner_id.*' => 'Zu welchem Partner gehört das Angebot?',
            'kind.*' => 'Aktivität oder Vorteil?',
            'title.required' => 'Wie heißt das Angebot?',
            'price_credits.min' => 'Ein Credit-Preis ist mindestens 1 Credit.',
        ]);

        // Die Regeln, die sich nur im Zusammenhang pruefen lassen.
        $price = array_key_exists('price_cents', $data) ? $data['price_cents'] : $offer?->price_cents;
        $credits = array_key_exists('price_credits', $data) ? $data['price_credits'] : $offer?->price_credits;
        if ($price === null && $credits === null) {
            throw ValidationException::withMessages(['price_cents' => ['Gib einen Preis in Euro, in Credits oder beides an.']]);
        }

        $min = $data['min_people'] ?? $offer?->min_people ?? 1;
        $max = array_key_exists('max_people', $data) ? $data['max_people'] : $offer?->max_people;
        if ($max !== null && $max < $min) {
            throw ValidationException::withMessages(['max_people' => ['Die Höchstzahl liegt unter der Mindestzahl.']]);
        }

        $minAge = array_key_exists('min_age', $data) ? $data['min_age'] : $offer?->min_age;
        $maxAge = array_key_exists('max_age', $data) ? $data['max_age'] : $offer?->max_age;
        if ($minAge !== null && $maxAge !== null && $maxAge < $minAge) {
            throw ValidationException::withMessages(['max_age' => ['Das Höchstalter liegt unter dem Mindestalter.']]);
        }

        return $data;
    }

    private function present(Request $request, Offer $offer): array
    {
        return (new OfferResource($offer))->toArray($request) + [
            'is_active' => (bool) $offer->is_active,
            'sort' => $offer->sort,
            'own_max_discount_percent' => $offer->max_discount_percent,
            'bookings_count' => $offer->bookings_count ?? Booking::where('offer_id', $offer->id)->count(),
        ];
    }
}
