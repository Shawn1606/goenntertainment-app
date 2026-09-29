<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Die Mail mit dem sechsstelligen Code - fuer die Anmeldung, das Einschalten der
 * E-Mail-Methode und das Bestaetigen heikler Aktionen.
 *
 * Nur Text, kein HTML. Nicht aus Sparsamkeit: Eine Code-Mail soll auf jedem
 * Geraet gleich aussehen, in der Vorschau der Mitteilung schon den Code zeigen
 * und moeglichst wenig nach Werbung aussehen - Spam-Filter und misstrauische
 * Menschen danken es gleichermassen. Der Satz „Falls du das nicht warst" ist der
 * wichtigste der Mail: Eine unerwartete Code-Mail heisst, jemand kennt das
 * Passwort.
 *
 * Nicht `ShouldQueue`: Es laeuft kein Queue-Worker, und ein Code, der erst
 * ankommt, wenn jemand die Warteschlange abarbeitet, ist abgelaufen.
 */
class TwoFactorCode extends Mailable
{
    public function __construct(
        public readonly string $code,
        public readonly int $minutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Dein GÖ4Fun-Code');
    }

    public function content(): Content
    {
        return new Content(text: 'mail.two-factor-code');
    }
}
