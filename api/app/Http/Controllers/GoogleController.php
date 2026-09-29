<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\User;
use App\Support\BlockedTerms;
use App\Support\TwoFactor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class GoogleController extends Controller
{
    /** Was an Stelle eines fehlenden oder gesperrten Google-Namens steht. */
    private const NEUTRAL_NAME = 'Google User';

    /**
     * POST /api/auth/google
     *
     * Die App holt sich bei Google einen access_token und schickt ihn hierher. Wir
     * pruefen ihn direkt bei Google, legen das Konto bei Bedarf an und geben einen
     * eigenen Token zurueck.
     *
     * ## Warum die Antwort hier OHNE Kategorien kommt
     *
     * Anders als bei /login und /register. Das ist uebernommen: Ein frisches
     * Google-Konto hat noch keine - es hat weder Benutzernamen noch Kontostufe,
     * und `profile_complete` ist entsprechend false. Die App schickt die Person
     * danach durch die Einrichtung und holt das vollstaendige Konto ueber
     * /api/user. Ein leeres Feld mitzusenden waere kein Gewinn.
     */
    public function store(Request $request): JsonResponse
    {
        Validator::make($request->all(), [
            'access_token' => ['bail', 'required', 'string'],
        ], [
            'access_token.required' => 'access_token ist erforderlich.',
            'access_token.string' => 'access_token ist erforderlich.',
        ])->validate();

        $response = Http::withToken((string) $request->input('access_token'))
            ->timeout(15)
            ->get('https://www.googleapis.com/oauth2/v3/userinfo');

        if (! $response->successful()) {
            throw ValidationException::withMessages([
                'access_token' => ['Der Google-Token ist ungueltig oder abgelaufen.'],
            ])->errorBag('default');
        }

        // { sub, email, name, picture, ... }
        $g = $response->json();

        $user = User::where('google_id', $g['sub'] ?? null)->first();

        if ($user === null) {
            $user = User::where('email', $g['email'] ?? null)->first();

            if ($user !== null) {
                // Bestehendes Konto mit Google verknuepfen.
                $user->google_id = $g['sub'] ?? null;
                $user->avatar = $g['picture'] ?? null;
                $user->save();
            } else {
                $user = new User;
                $user->name = self::nameFromGoogle($g['name'] ?? null);
                $user->email = $g['email'] ?? null;
                $user->google_id = $g['sub'] ?? null;
                $user->avatar = $g['picture'] ?? null;
                // Google hat die Adresse bestaetigt - wir muessen es nicht erneut tun.
                $user->email_verified_at = now();
                $user->save();
            }
        }

        /**
         * Zwei-Faktor-Anmeldung an: dieselbe Antwort wie bei POST /login - ein
         * Vorgang statt eines Tokens. Ein gueltiger Google-Token beweist nur,
         * dass jemand an das Google-Konto kommt; der zweite Faktor gehoert zu
         * DIESEM Konto und wird hier genauso verlangt. Weiter geht es mit
         * POST /login/two-factor.
         */
        if (TwoFactor::isEnabled($user)) {
            return TwoFactor::startLogin($user);
        }

        $deviceName = $request->input('device_name');
        $name = (is_string($deviceName) && $deviceName !== '') ? $deviceName : 'mobile';

        return response()->json([
            'user' => (new UserResource($user))->toArray($request),
            'token' => $user->createToken($name)->plainTextToken,
            'profile_complete' => $user->profileComplete(),
        ]);
    }

    /**
     * Der Anzeigename fuer ein neues Google-Konto.
     *
     * ## Warum ein gesperrter Name ersetzt und nicht abgelehnt wird
     *
     * Den Namen hat die Person nicht bei uns eingetippt, sondern bei Google
     * hinterlegt - vielleicht vor Jahren, vielleicht als Scherz. Eine Ablehnung
     * hiesse: Die Anmeldung mit Google geht nicht, und in der App gibt es kein Feld,
     * in dem man das beheben koennte. Stattdessen bekommt das Konto denselben
     * neutralen Namen wie eines, fuer das Google gar keinen liefert, und die
     * Einrichtung danach laeuft wie immer: Benutzername und Profil gehen ueber
     * PATCH /api/user - und dort gilt die Liste (NoBlockedTerms) wieder.
     *
     * Bestehende Konten, die nur verknuepft werden, behalten ihren Namen; der kam
     * ohnehin nicht von Google.
     */
    private static function nameFromGoogle(mixed $name): string
    {
        if (! is_string($name) || trim($name) === '') {
            return self::NEUTRAL_NAME;
        }

        return BlockedTerms::default()->find($name, 'name') === null ? $name : self::NEUTRAL_NAME;
    }
}
