<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Support\Uploads;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Das eigene Profilbild hochladen oder entfernen.
 *
 * Sichtbar ist es in der Kopfzeile, im Konto und bei den Gruppenmitgliedern.
 * Ein ersetztes Bild wird geloescht - es haengt an keinem anderen Datensatz.
 * Ein Google-Profilbild (fremde Adresse) bleibt dabei unangetastet.
 */
class AvatarController extends Controller
{
    /** POST /api/user/avatar {image} */
    public function store(Request $request): JsonResponse
    {
        $request->validate(['image' => Uploads::rule()], [
            'image.*' => 'Bitte ein Bild wählen (jpg, png oder webp, höchstens 5 MB).',
        ]);

        $user = $request->user();
        $previous = $user->avatar;
        $user->forceFill(['avatar' => Uploads::store($request->file('image'), 'avatars')])->save();
        Uploads::delete($previous);

        return response()->json(['user' => (new UserResource($user))->withInterests()->toArray($request)]);
    }

    /** DELETE /api/user/avatar */
    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user();
        $previous = $user->avatar;
        $user->forceFill(['avatar' => null])->save();
        Uploads::delete($previous);

        return response()->json(['user' => (new UserResource($user))->withInterests()->toArray($request)]);
    }
}
