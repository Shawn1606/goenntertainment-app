<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The mail with the 6-digit code that resets a password (F-09; App\Support\PasswordReset). The
 * code is typed into the app: no link, no deep link.
 *
 * Text only, like TwoFactorCode, and neutral (no support channel or contact, P2-11). The last
 * sentence matters most: an unexpected reset mail means someone typed this address, and nothing
 * changes unless the code is used.
 *
 * Not `ShouldQueue`: no queue worker runs, and a code that arrives late has expired.
 */
class PasswordResetCode extends Mailable
{
    public function __construct(
        public readonly string $code,
        public readonly int $minutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Dein GÖ4Fun-Code zum Zurücksetzen des Passworts');
    }

    public function content(): Content
    {
        return new Content(text: 'mail.password-reset-code');
    }
}
