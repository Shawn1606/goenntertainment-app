<?php

namespace App\Support\TestPhase;

use App\Models\User;

/**
 * Die Testphase: Club-Ideen, die erst ausprobiert werden, bevor sie fuer alle
 * gelten - Stadt-Bingo, Challenges, Check-in-Serie, Goenni als Coach und der
 * doppelte Stempel beim ersten Besuch eines Partners.
 *
 * ## Wer sie sieht
 *
 * Nur Admins. Fuer sie ist alles echt (Stempel, Credits), fuer alle anderen
 * aendert sich nichts. Gezeigt wird alles auf dem Admin-Bildschirm „Test"
 * (src/app/admin-test.tsx, GET /api/admin/testphase).
 *
 * Soll eine Idee fuer alle gelten, wandert sie aus der Testphase heraus - die
 * Pruefung hier ist dann die einzige Stelle, die sich aendert.
 */
final class TestPhase
{
    public static function enabledFor(?User $user): bool
    {
        return (bool) ($user?->is_admin ?? false);
    }
}
