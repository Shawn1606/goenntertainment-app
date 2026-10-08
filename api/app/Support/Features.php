<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Schalter fuer Funktionen - fuer alle Nutzer oder nur fuer einen Admin.
 *
 * ## Zwei Ebenen
 *
 *  - **Fuer alle** (`feature_flags`): Was hier an ist, sehen alle Nutzer.
 *    Admin-Bereich › „Funktionen fuer alle".
 *  - **Nur fuer mich** (`feature_previews`): Ein Admin schaltet fuer SICH eine
 *    Funktion an oder aus bzw. waehlt ein Saison-Thema - zum Ausprobieren, ohne
 *    dass es sonst jemand sieht. Admin-Bereich › „Nur fuer mich". Ohne Eintrag
 *    gilt, was fuer alle gilt.
 *
 * ## Was es gibt
 *
 *  - `bingo` (Schalter): Stadt-Bingo. Aus der Testphase geholt; laeuft zweimal
 *    im Jahr und ist deshalb standardmaessig AUS.
 *  - `season` (Auswahl): Saison-Thema der Deko und von Goennis Look. „auto" =
 *    nach Datum (src/domain/season.ts), sonst fest eine Saison.
 *
 * Normale Nutzer bekommen nur, was fuer alle gilt; Vorschauen zaehlen nur fuer
 * Admins - wird jemandem das Admin-Recht genommen, sind seine Vorschauen wirkungslos.
 */
final class Features
{
    /** Saison-Themen - gleiche Schluessel wie `SeasonKey` in src/domain/season.ts. */
    public const SEASONS = ['halloween', 'advent', 'newyear', 'winter', 'valentine', 'easter', 'spring', 'summer', 'autumn'];

    /**
     * Die Schalter mit Beschriftung fuer die Admin-Bildschirme.
     *
     * @var array<string, array{type: 'switch'|'choice', label: string, hint: string, default: bool|string}>
     */
    public const DEFINITIONS = [
        'bingo' => [
            'type' => 'switch',
            'label' => 'Stadt-Bingo',
            'hint' => 'Monatsfeld mit Partnern und kleinen Aufgaben; volle Reihen bringen Credits. Läuft zweimal im Jahr.',
            'default' => false,
        ],
        'season' => [
            'type' => 'choice',
            'label' => 'Saison-Thema',
            'hint' => 'Deko in der Kopfzeile und Goennis Look. „Automatisch" richtet sich nach dem Datum.',
            'default' => 'auto',
        ],
    ];

    /** @return array<string, array{enabled?: bool, value?: string}> */
    public static function global(): array
    {
        $rows = DB::table('feature_flags')->whereIn('key', array_keys(self::DEFINITIONS))->get()->keyBy('key');
        $out = [];
        foreach (self::DEFINITIONS as $key => $def) {
            $row = $rows->get($key);
            $out[$key] = $def['type'] === 'switch'
                ? ['enabled' => $row !== null ? (bool) $row->enabled : (bool) $def['default']]
                : ['value' => $row !== null && $row->value !== null ? (string) $row->value : (string) $def['default']];
        }

        return $out;
    }

    /**
     * Die Vorschau eines Admins: `mode` inherit|on|off bzw. `value` (null = wie fuer alle).
     *
     * @return array<string, array{mode?: string, value?: string|null}>
     */
    public static function previews(User $user): array
    {
        $rows = DB::table('feature_previews')->where('user_id', $user->getKey())->get()->keyBy('key');
        $out = [];
        foreach (self::DEFINITIONS as $key => $def) {
            $row = $rows->get($key);
            $out[$key] = $def['type'] === 'switch'
                ? ['mode' => $row === null || $row->enabled === null ? 'inherit' : ((bool) $row->enabled ? 'on' : 'off')]
                : ['value' => $row?->value];
        }

        return $out;
    }

    /**
     * Was fuer DIESES Konto gilt - so bekommt es die App (GET /api/features).
     *
     * @return array{bingo: bool, season: string|null}
     */
    public static function effective(User $user): array
    {
        $global = self::global();
        $own = $user->is_admin ? self::previews($user) : null;

        $bingo = $global['bingo']['enabled'];
        if ($own !== null && $own['bingo']['mode'] !== 'inherit') {
            $bingo = $own['bingo']['mode'] === 'on';
        }

        $season = $own !== null && $own['season']['value'] !== null ? $own['season']['value'] : $global['season']['value'];

        return ['bingo' => $bingo, 'season' => $season === 'auto' ? null : $season];
    }

    public static function enabled(User $user, string $key): bool
    {
        return (bool) (self::effective($user)[$key] ?? false);
    }

    /** Fuer alle: Schalter umlegen bzw. Wert setzen. */
    public static function setGlobal(string $key, ?bool $enabled, ?string $value): void
    {
        $def = self::definition($key);
        $attrs = $def['type'] === 'switch'
            ? ['enabled' => (bool) $enabled, 'value' => null]
            : ['enabled' => false, 'value' => self::choice($value, allowInherit: false)];

        DB::table('feature_flags')->updateOrInsert(['key' => $key], $attrs + ['updated_at' => now(), 'created_at' => now()]);
    }

    /** Nur fuer einen Admin: `mode` inherit|on|off bzw. `value` (null/„inherit" = wie fuer alle). */
    public static function setPreview(User $user, string $key, ?string $mode, ?string $value): void
    {
        $def = self::definition($key);

        if ($def['type'] === 'switch') {
            if (! in_array($mode, ['inherit', 'on', 'off'], true)) {
                throw ValidationException::withMessages(['mode' => ['Erlaubt: inherit, on, off.']]);
            }
            if ($mode === 'inherit') {
                self::clearPreview($user, $key);

                return;
            }
            $attrs = ['enabled' => $mode === 'on', 'value' => null];
        } else {
            $choice = self::choice($value, allowInherit: true);
            if ($choice === null) {
                self::clearPreview($user, $key);

                return;
            }
            $attrs = ['enabled' => null, 'value' => $choice];
        }

        DB::table('feature_previews')->updateOrInsert(
            ['user_id' => $user->getKey(), 'key' => $key],
            $attrs + ['updated_at' => now(), 'created_at' => now()],
        );
    }

    /** Alles fuer die Admin-Bildschirme in einem Stand. */
    public static function adminState(User $user): array
    {
        $definitions = [];
        foreach (self::DEFINITIONS as $key => $def) {
            $definitions[] = [
                'key' => $key,
                'type' => $def['type'],
                'label' => $def['label'],
                'hint' => $def['hint'],
                'choices' => $def['type'] === 'choice' ? ['auto', ...self::SEASONS] : null,
            ];
        }

        return [
            'definitions' => $definitions,
            'global' => self::global(),
            'preview' => self::previews($user),
            'effective' => self::effective($user),
        ];
    }

    /** @return array{type: 'switch'|'choice', label: string, hint: string, default: bool|string} */
    private static function definition(string $key): array
    {
        $def = self::DEFINITIONS[$key] ?? null;
        if ($def === null) {
            abort(404, 'Diesen Schalter gibt es nicht.');
        }

        return $def;
    }

    private static function choice(?string $value, bool $allowInherit): ?string
    {
        if ($allowInherit && ($value === null || $value === 'inherit')) {
            return null;
        }
        if ($value === 'auto' || in_array($value, self::SEASONS, true)) {
            return $value;
        }

        throw ValidationException::withMessages(['value' => ['Unbekanntes Saison-Thema.']]);
    }

    private static function clearPreview(User $user, string $key): void
    {
        DB::table('feature_previews')->where('user_id', $user->getKey())->where('key', $key)->delete();
    }
}
