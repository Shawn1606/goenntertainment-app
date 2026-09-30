<?php

namespace App\Http\Resources;

use App\Models\Booking;
use App\Support\Codes;
use App\Support\Format;
use App\Support\Media;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Eine Buchung - der Beleg in der App.
 *
 * `status` ist der ANGEZEIGTE Zustand inklusive `expired`
 * (App\Models\Booking::displayStatus). Titel und Partnername kommen aus dem
 * Schnappschuss, Bild und Ort vom Partner, solange es ihn gibt.
 *
 * @mixin Booking
 */
class BookingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $partner = $this->relationLoaded('partner') ? $this->partner : null;
        $offer = $this->relationLoaded('offer') ? $this->offer : null;
        $group = $this->relationLoaded('group') ? $this->group : null;

        return [
            'id' => $this->id,
            'code' => Codes::format($this->code),
            'status' => $this->displayStatus(),
            'offer_id' => $this->offer_id,
            'offer_title' => $this->offer_title,
            'partner_id' => $this->partner_id,
            'partner_name' => $this->partner_name,
            'image_url' => Media::url($offer?->image_path ?? $partner?->cover_path, $request),
            'partner' => $partner ? [
                'id' => $partner->id,
                'name' => $partner->name,
                'logo_url' => Media::url($partner->logo_path, $request),
                'address' => $partner->address,
                'city' => $partner->city,
                'lat' => $partner->lat,
                'lng' => $partner->lng,
                'phone' => $partner->phone,
            ] : null,
            'group' => $group ? ['id' => $group->id, 'name' => $group->name] : null,
            'people' => $this->people,
            'plan_key' => $this->plan_key,
            'pay_method' => $this->pay_method,
            'unit_price_cents' => $this->unit_price_cents,
            'unit_credits' => $this->unit_credits,
            'discount_percent' => $this->discount_percent,
            'subtotal_cents' => $this->subtotal_cents,
            'discount_cents' => $this->discount_cents,
            'total_cents' => $this->total_cents,
            'subtotal_credits' => $this->subtotal_credits,
            'total_credits' => $this->total_credits,
            'preferred_date' => $this->preferred_date?->format('Y-m-d'),
            'valid_until' => Format::iso($this->valid_until),
            'redeemed_at' => Format::iso($this->redeemed_at),
            'cancelled_at' => Format::iso($this->cancelled_at),
            'created_at' => Format::iso($this->created_at),
        ];
    }
}
