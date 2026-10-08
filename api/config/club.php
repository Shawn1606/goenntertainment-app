<?php

/**
 * Einstellungen des Marktplatzes. Die Club-REGELN (Preise, Rabatte, Stempel)
 * stehen nicht hier, sondern in shared/club.json - die App braucht sie auch.
 */
return [
    /*
     * test = Zahlungen werden simuliert und gelten sofort als bezahlt
     *        (App\Support\Payments). Kein Geld fliesst.
     * off  = Bezahlen ist gesperrt (503).
     *
     * Vorgabe: test ausser in Produktion. Wer auf dem Server testen will, setzt
     * PAYMENTS_MODE=test ausdruecklich.
     */
    'payments' => env('PAYMENTS_MODE', env('APP_ENV') === 'production' ? 'off' : 'test'),

    /*
     * Check-in per Aufkleber: Wie weit darf das Handy vom Partner weg sein?
     * Schuetzt davor, dass ein abfotografierter QR-Code zu Hause Stempel
     * bringt. 0 = keine Pruefung. Scannt der PARTNER den Pass, gilt das nicht -
     * dann steht die Person ja vor ihm.
     */
    'checkin_radius_m' => (int) env('CHECKIN_RADIUS_M', 400),

    /* Wie lange ein Kunden-Pass (QR fuer den Partner-Scan) gilt. */
    'pass_ttl_seconds' => 120,

    // Offline-Pass (App\Support\Pass::issueOffline): nur ohne Netz gezeigt.
    'pass_offline_ttl_seconds' => (int) env('PASS_OFFLINE_TTL', 10800),
];
