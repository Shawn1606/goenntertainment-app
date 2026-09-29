<?php

namespace App\Support;

use App\Models\User;

/**
 * Kontostufen der Server-Seite: Standard, Creator, Business, Business Plus.
 *
 * Hier steht, was eine Stufe DARF. Die App kennt dieselben Regeln (samt Texten)
 * in src/domain/account.ts - die App versteckt damit nur, was der Server hier
 * tatsaechlich verbietet. Wer eine Stufe aendert, muss beide Dateien anfassen.
 */
class AccountTypes
{
    /** Aufsteigend geordnet - die Reihenfolge ist die Rangfolge. */
    public const ALL = ['standard', 'creator', 'business', 'business_plus'];

    /**
     * Was man sich bei der Registrierung selbst geben darf: nur die kleinste Stufe.
     *
     * Alles darueber schaltet Rechte frei (Events anlegen, oeffentliches Profil,
     * Business-Bereich) und braucht deshalb ein Ja vom Admin. 'creator' stand hier
     * fruehr mit drin: Damit war die Bestaetigung wertlos, denn wer nicht warten
     * wollte, hat sich ein neues Konto gleich als Creator angelegt.
     */
    public const SELF_SERVICE = ['standard'];

    /**
     * Was man ANFRAGEN kann. Standard fehlt: Das ist die Stufe, mit der jedes
     * Konto anfaengt - niemand fragt sie an.
     */
    public const REQUESTABLE = ['creator', 'business', 'business_plus'];

    /**
     * 'personal' ist der Wert, den die App vor den vier Kontostufen geschickt hat.
     * Wir nehmen ihn weiter an (installierte Builds sollen nicht bei der
     * Registrierung scheitern) und speichern ihn als 'standard'.
     */
    public const LEGACY = 'personal';

    /** Wie lange ein Hervorheben laeuft, wenn es gesetzt wird. */
    public const BOOST_DAYS = 7;

    /** Rechte je Stufe - gleiche Werte wie src/domain/account.ts. */
    private const CAPABILITIES = [
        'standard' => ['canCreateActivities' => false, 'hasBusinessArea' => false, 'hasPublicProfile' => false, 'boostSlots' => 0, 'insightMonths' => 0],
        'creator' => ['canCreateActivities' => true, 'hasBusinessArea' => false, 'hasPublicProfile' => true, 'boostSlots' => 0, 'insightMonths' => 0],
        'business' => ['canCreateActivities' => true, 'hasBusinessArea' => true, 'hasPublicProfile' => true, 'boostSlots' => 1, 'insightMonths' => 3],
        'business_plus' => ['canCreateActivities' => true, 'hasBusinessArea' => true, 'hasPublicProfile' => true, 'boostSlots' => 5, 'insightMonths' => 12],
    ];

    /** Was man sich selbst geben darf - inkl. des alten Werts. */
    public static function registrable(): array
    {
        return [...self::SELF_SERVICE, self::LEGACY];
    }

    /** Was ein Admin vergeben darf - inkl. des alten Werts. */
    public static function assignable(): array
    {
        return [...self::ALL, self::LEGACY];
    }

    /**
     * Alte Werte mitlesen: Bestandskonten stehen noch auf 'personal' - das ist
     * heute 'standard'. NULL kommt von Google-Konten und faellt ebenfalls auf die
     * kleinste Stufe: im Zweifel weniger Rechte, nicht mehr.
     */
    public static function normalize(?string $raw): string
    {
        if ($raw === self::LEGACY) {
            return 'standard';
        }

        return in_array($raw, self::ALL, true) ? $raw : 'standard';
    }

    /** Rang in der Leiter (0 = Standard). */
    public static function rankOf(?string $raw): int
    {
        return (int) array_search(self::normalize($raw), self::ALL, true);
    }

    /** Rechte einer Stufe. */
    public static function capabilitiesFor(?string $raw): array
    {
        return self::CAPABILITIES[self::normalize($raw)];
    }

    /**
     * Welche Stufen dieses Konto anfragen darf: alles UEBER der eigenen.
     *
     * Nur nach oben - ein Zurueckstufen ist keine Anfrage, sondern eine
     * Admin-Entscheidung. Auf der hoechsten Stufe kommt eine leere Liste zurueck,
     * und die App zeigt dann gar keinen Knopf.
     */
    public static function requestableFor(?string $raw): array
    {
        $rank = self::rankOf($raw);

        return array_values(array_filter(
            self::REQUESTABLE,
            fn (string $type) => self::rankOf($type) > $rank,
        ));
    }

    /**
     * Rechte eines Kontos inkl. Admin-Ausnahme.
     *
     * Admins duerfen Events anlegen, ganz gleich auf welcher Stufe sie stehen: Sie
     * verteilen die Stufen und muessen jede pruefen koennen, ohne sich selbst
     * auszusperren. Der Business-Bereich folgt dagegen weiter der eingestellten
     * Stufe - sonst koennte ein Admin nie nachsehen, was ein Standard-Konto sieht.
     */
    public static function abilitiesFor(?User $user): array
    {
        $base = self::capabilitiesFor($user?->account_type);

        if ($user === null || ! $user->is_admin) {
            return $base;
        }

        // Die EINZIGE Ausnahme fuer Admins.
        return [...$base, 'canCreateActivities' => true];
    }
}
