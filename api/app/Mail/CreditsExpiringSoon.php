<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Erinnerung: Credits verfallen bald (30 bzw. 7 Tage vorher,
 * App\Support\CreditReminders). Mit bis zu drei Angeboten, die man mit den
 * Credits noch bezahlen kann.
 *
 * Nur Text - wie die Code-Mail. Nicht `ShouldQueue`: Es laeuft kein Worker.
 */
class CreditsExpiringSoon extends Mailable
{
    /**
     * @param  list<array{title: string, partner: string, credits: int}>  $offers
     */
    public function __construct(
        public readonly string $firstName,
        public readonly int $credits,
        public readonly string $date,
        public readonly int $days,
        public readonly array $offers,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "{$this->credits} Credits verfallen am {$this->date}");
    }

    public function content(): Content
    {
        return new Content(text: 'mail.credits-expiring');
    }
}
