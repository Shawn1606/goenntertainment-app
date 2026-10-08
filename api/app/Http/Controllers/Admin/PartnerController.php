<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Resources\PartnerResource;
use App\Models\Partner;
use App\Models\User;
use App\Support\Media;
use App\Support\Uploads;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Partner verwalten. Das Partnerprogramm ist exklusiv - Partner legt nur ein
 * Admin an, nachdem der Vertrag steht.
 *
 * Im Admin-Bereich steht zusaetzlich, was auf den Aufkleber an der Kasse gehoert
 * (`checkin_url`), und wer im Partner-Modus scannen darf.
 */
class PartnerController extends Controller
{
    /** GET /api/admin/partners - alle, auch inaktive. */
    public function index(Request $request): JsonResponse
    {
        $partners = Partner::withCount(['offers', 'staff'])->orderBy('name')->get();

        return response()->json(['data' => $partners->map(fn (Partner $p) => $this->present($request, $p))]);
    }

    /** GET /api/admin/partners/{partner} */
    public function show(Request $request, Partner $partner): JsonResponse
    {
        $partner->loadCount(['offers', 'staff'])->load('staff');

        return response()->json(['data' => $this->present($request, $partner, withStaff: true)]);
    }

    /** POST /api/admin/partners */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, null);
        $partner = new Partner($data);
        $partner->slug = $this->uniqueSlug($data['slug'] ?? $data['name']);
        $partner->checkin_token = Str::random(32);
        $partner->save();

        return response()->json(['data' => $this->present($request, $partner->loadCount(['offers', 'staff']))], 201);
    }

    /** PATCH /api/admin/partners/{partner} */
    public function update(Request $request, Partner $partner): JsonResponse
    {
        $data = $this->validated($request, $partner);
        if (isset($data['slug']) && $data['slug'] !== $partner->slug) {
            $data['slug'] = $this->uniqueSlug($data['slug'], $partner->id);
        }
        $partner->update($data);

        return response()->json(['data' => $this->present($request, $partner->loadCount(['offers', 'staff']))]);
    }

    /**
     * DELETE /api/admin/partners/{partner}
     *
     * Loescht mit allen Angeboten. Buchungen bleiben (Schnappschuss, partner_id
     * NULL) - die Abrechnung darf nicht mit verschwinden. Wer einen Partner nur
     * pausieren will, setzt `is_active` auf false.
     */
    public function destroy(Partner $partner): JsonResponse
    {
        Uploads::delete($partner->logo_path);
        Uploads::delete($partner->cover_path);
        foreach ($partner->offers as $offer) {
            Uploads::delete($offer->image_path);
        }
        $partner->delete();

        return response()->json(['message' => 'Partner gelöscht.']);
    }

    /** POST /api/admin/partners/{partner}/image {kind: logo|cover, image} */
    public function image(Request $request, Partner $partner): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(['logo', 'cover'])],
            'image' => Uploads::rule(),
        ], ['image.*' => 'Bitte ein Bild wählen (jpg, png oder webp, höchstens 5 MB).']);

        $column = $data['kind'] === 'logo' ? 'logo_path' : 'cover_path';
        $previous = $partner->{$column};
        $partner->forceFill([$column => Uploads::store($request->file('image'), 'partners')])->save();
        Uploads::delete($previous);

        return response()->json(['data' => $this->present($request, $partner->loadCount(['offers', 'staff']))]);
    }

    /**
     * POST /api/admin/partners/{partner}/rotate-token - neuer Aufkleber-Code.
     * Nur noetig, wenn ein Aufkleber missbraucht wird: Danach taugen ALLE alten
     * Aufkleber dieses Partners nicht mehr.
     */
    public function rotateToken(Request $request, Partner $partner): JsonResponse
    {
        $partner->forceFill(['checkin_token' => Str::random(32)])->save();

        return response()->json(['data' => $this->present($request, $partner->loadCount(['offers', 'staff']))]);
    }

    /** POST /api/admin/partners/{partner}/staff {email, role?} */
    public function addStaff(Request $request, Partner $partner): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string'],
            'role' => ['nullable', Rule::in(['staff', 'manager'])],
        ], ['email.*' => 'Gib die E-Mail-Adresse des Kontos an.']);

        $user = User::where('email', trim($data['email']))->first();
        if ($user === null) {
            throw ValidationException::withMessages(['email' => ['Zu dieser E-Mail gibt es kein Konto. Die Person muss sich erst in der App registrieren.']]);
        }

        $partner->staff()->syncWithoutDetaching([$user->id => ['role' => $data['role'] ?? 'staff', 'created_at' => now()]]);

        return $this->show($request, $partner);
    }

    /** DELETE /api/admin/partners/{partner}/staff/{userId} */
    public function removeStaff(Request $request, Partner $partner, int $userId): JsonResponse
    {
        $partner->staff()->detach($userId);

        return $this->show($request, $partner);
    }

    private function validated(Request $request, ?Partner $partner): array
    {
        $required = $partner ? 'sometimes' : 'required';

        $data = $request->validate([
            'name' => [$required, 'string', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:80'],
            'tagline' => ['sometimes', 'nullable', 'string', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'interest_id' => ['sometimes', 'nullable', 'integer', 'exists:interests,id'],
            'address' => ['sometimes', 'nullable', 'string', 'max:200'],
            'city' => ['sometimes', 'nullable', 'string', 'max:80'],
            'lat' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'lng' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'website' => ['sometimes', 'nullable', 'url:http,https', 'max:200'],
            'instagram' => ['sometimes', 'nullable', 'string', 'max:80'],
            'opening_hours' => ['sometimes', 'nullable', 'string', 'max:500'],
            'max_discount_percent' => ['sometimes', 'nullable', 'integer', 'between:0,100'],
            'is_active' => ['sometimes', 'boolean'],
            'is_featured' => ['sometimes', 'boolean'],
            // Barrierefreiheit: null = unbekannt
            'wheelchair_accessible' => ['sometimes', 'nullable', 'boolean'],
            'kid_friendly' => ['sometimes', 'nullable', 'boolean'],
            'quiet_times' => ['sometimes', 'nullable', 'string', 'max:160'],
        ], [
            'name.required' => 'Wie heißt der Partner?',
            'website.url' => 'Die Webseite muss mit http:// oder https:// beginnen.',
            'interest_id.exists' => 'Diese Kategorie gibt es nicht.',
            'max_discount_percent.between' => 'Der Höchstrabatt liegt zwischen 0 und 100 %.',
        ]);

        if (isset($data['instagram'])) {
            $data['instagram'] = ltrim(trim($data['instagram']), '@') ?: null;
        }

        return $data;
    }

    private function uniqueSlug(string $source, ?int $ignoreId = null): string
    {
        $base = Str::slug($source) ?: 'partner';
        $slug = $base;
        $n = 2;
        while (Partner::where('slug', $slug)->when($ignoreId, fn ($q) => $q->whereKeyNot($ignoreId))->exists()) {
            $slug = $base.'-'.$n++;
        }

        return $slug;
    }

    private function present(Request $request, Partner $partner, bool $withStaff = false): array
    {
        $data = (new PartnerResource($partner))->toArray($request);
        unset($data['offers']);

        $base = Media::base($request);
        $data += [
            'is_active' => (bool) $partner->is_active,
            'max_discount_percent' => $partner->max_discount_percent,
            'offers_count' => (int) ($partner->offers_count ?? 0),
            'staff_count' => (int) ($partner->staff_count ?? 0),
            // Das gehoert auf den NFC-Aufkleber UND als QR-Code darauf gedruckt.
            'checkin_token' => $partner->checkin_token,
            'checkin_url' => $base.'/c/'.$partner->checkin_token,
        ];

        if ($withStaff) {
            $data['staff'] = $partner->staff->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'role' => $u->pivot->role,
            ]);
        }

        return $data;
    }
}
