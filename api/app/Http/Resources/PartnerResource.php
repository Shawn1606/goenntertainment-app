<?php

namespace App\Http\Resources;

use App\Models\Partner;
use App\Support\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Ein Partner, wie die App ihn sieht. `checkin_token` fehlt absichtlich - der
 * steht nur auf dem Aufkleber (und im Admin-Bereich, Admin\PartnerController).
 *
 * @mixin Partner
 */
class PartnerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'slug' => $this->slug,
            'name' => $this->name,
            'tagline' => $this->tagline,
            'description' => $this->description,
            'interest_id' => $this->interest_id,
            'address' => $this->address,
            'city' => $this->city,
            'lat' => $this->lat,
            'lng' => $this->lng,
            'logo_url' => Media::url($this->logo_path, $request),
            'cover_url' => Media::url($this->cover_path, $request),
            'phone' => $this->phone,
            'website' => $this->website,
            'instagram' => $this->instagram,
            'opening_hours' => $this->opening_hours,
            'is_featured' => (bool) $this->is_featured,
            'offers' => OfferResource::collection($this->whenLoaded('offers')),
        ];
    }
}
