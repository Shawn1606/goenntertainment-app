<?php

namespace App\Http\Resources;

use App\Models\Offer;
use App\Support\Club;
use App\Support\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Ein Angebot mit dem Noetigsten vom Partner - genug fuer Karte, Liste und
 * Gruppen-Finder, ohne zweite Anfrage.
 *
 * `max_discount_percent` ist der Deckel, der WIRKLICH gilt (Angebot, sonst
 * Partner, sonst allgemein). Damit rechnet die App dieselbe Vorschau wie der
 * Server beim Buchen.
 *
 * @mixin Offer
 */
class OfferResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $partner = $this->relationLoaded('partner') ? $this->partner : null;

        return [
            'id' => $this->id,
            'partner_id' => $this->partner_id,
            'kind' => $this->kind,
            'title' => $this->title,
            'subtitle' => $this->subtitle,
            'description' => $this->description,
            'interest_id' => $this->interest_id,
            // Ohne eigenes Bild das Titelbild des Partners - eine Karte ohne Bild
            // wirkt wie ein Platzhalter.
            'image_url' => Media::url($this->image_path ?? $partner?->cover_path, $request),
            'price_cents' => $this->price_cents,
            'price_credits' => $this->price_credits,
            'max_discount_percent' => $this->effectiveMaxDiscount() ?? (int) Club::rules()['discountCap']['defaultPercent'],
            'min_people' => $this->min_people,
            'max_people' => $this->max_people,
            'min_age' => $this->min_age,
            'max_age' => $this->max_age,
            'duration_minutes' => $this->duration_minutes,
            'indoor' => $this->indoor,
            'valid_days' => $this->valid_days,
            // Testphase: Tageskontingent, davon fuer Platinum reserviert.
            'daily_capacity' => $this->daily_capacity,
            'platinum_reserved' => (int) ($this->platinum_reserved ?? 0),
            'is_featured' => (bool) $this->is_featured,
            'partner' => $partner ? [
                'id' => $partner->id,
                'slug' => $partner->slug,
                'name' => $partner->name,
                'logo_url' => Media::url($partner->logo_path, $request),
                'cover_url' => Media::url($partner->cover_path, $request),
                'address' => $partner->address,
                'city' => $partner->city,
                'lat' => $partner->lat,
                'lng' => $partner->lng,
                'interest_id' => $partner->interest_id,
                'wheelchair_accessible' => $partner->wheelchair_accessible,
                'kid_friendly' => $partner->kid_friendly,
                'quiet_times' => $partner->quiet_times,
            ] : null,
        ];
    }
}
