<?php

namespace App\Rules;

use App\Support\EmailAddress;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validation rule: a usable e-mail address of at most 254 characters, checked in linear time
 * (App\Support\EmailAddress). Fails with the text the app has always shown for a bad address.
 *
 *     'email' => ['bail', 'required', new ValidEmail],
 */
final class ValidEmail implements ValidationRule
{
    public const MESSAGE = 'Bitte eine gueltige E-Mail-Adresse angeben.';

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! EmailAddress::isValid($value)) {
            $fail(self::MESSAGE);
        }
    }
}
