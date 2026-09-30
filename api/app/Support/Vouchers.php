<?php

namespace App\Support;

use App\Models\User;
use App\Models\Voucher;
use App\Models\VoucherBatch;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Gutscheinkarten: Codes erzeugen (Admin) und einloesen (App).
 *
 * Die Karten verkauft der Handel (REWE, Kaufland ...) - nur Partner des
 * Programms. Auf der Karte steht ein Code aus zwoelf Zeichen, gedruckt als
 * ABCD-EFGH-JKLM. Bei 32^12 Moeglichkeiten ist Raten aussichtslos; zusaetzlich
 * bremst das Rate-Limit `voucher-redeem` (AppServiceProvider).
 */
final class Vouchers
{
    public const CODE_LENGTH = 12;

    public static function generate(VoucherBatch $batch): void
    {
        DB::transaction(function () use ($batch) {
            $now = now();
            $rows = [];
            $seen = [];
            for ($i = 0; $i < $batch->quantity; $i++) {
                $code = Codes::unique(self::CODE_LENGTH, fn (string $c) => isset($seen[$c]) || Voucher::where('code', $c)->exists());
                $seen[$code] = true;
                $rows[] = [
                    'batch_id' => $batch->getKey(),
                    'code' => $code,
                    'credits' => $batch->credits,
                    'expires_at' => $batch->expires_at,
                    'created_at' => $now,
                ];
                if (count($rows) === 500) {
                    Voucher::insert($rows);
                    $rows = [];
                }
            }
            if ($rows !== []) {
                Voucher::insert($rows);
            }
        });
    }

    /** Einloesen: Credits aufs Konto, Code verbraucht. Jeder Fehler als 422 mit Klartext. */
    public static function redeem(User $user, string $input): Voucher
    {
        $code = Codes::normalize($input);
        $fail = fn (string $message) => ValidationException::withMessages(['code' => [$message]]);

        if (strlen($code) !== self::CODE_LENGTH) {
            throw $fail('Ein Gutscheincode hat 12 Zeichen – zum Beispiel ABCD-EFGH-JKLM.');
        }

        return DB::transaction(function () use ($user, $code, $fail) {
            $voucher = Voucher::where('code', $code)->lockForUpdate()->first();

            if ($voucher === null || $voucher->disabled_at !== null) {
                throw $fail('Diesen Code kennen wir nicht. Tippfehler? Prüf ihn bitte noch mal.');
            }
            if ($voucher->redeemed_at !== null) {
                throw $fail($voucher->redeemed_by === $user->getKey()
                    ? 'Den hast du schon eingelöst – die Credits sind auf deinem Konto.'
                    : 'Dieser Code wurde schon eingelöst.');
            }
            if ($voucher->expires_at !== null && $voucher->expires_at->isPast()) {
                throw $fail('Dieser Gutschein ist abgelaufen.');
            }

            $voucher->update(['redeemed_by' => $user->getKey(), 'redeemed_at' => now()]);
            Wallet::credit($user, $voucher->credits, 'voucher', 'Gutschein eingelöst', ['voucher_id' => $voucher->getKey()]);

            return $voucher;
        });
    }
}
