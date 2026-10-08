<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Hash;

/**
 * The first admin account, created before the public edge may start (F-05). A port of Node's
 * `npm run seed:admin` (server/src/seed.js, seedAdmin), which the deploy no longer runs.
 *
 * `php artisan admin:create` (routes/console.php) runs it, from the one-off `seed` service of
 * deploy/docker-compose.yml (deploy/README.md, First start), with ADMIN_EMAIL and ADMIN_PASSWORD
 * set for that one run from the operator's shell: never in deploy/.env and never in a
 * long-running container (F-18).
 *
 * It only CREATES. When an account with the address or with the username "admin" exists, it
 * refuses and changes nothing: adopting that account would hand admin rights to whoever
 * registered the address or the name first, keep their tokens and second factor, and reset the
 * password on every run. Further admins come from accounts that exist, with
 * `php artisan admin:grant <email>`.
 *
 * The password goes through the sign-up's policy (App\Support\PasswordPolicy), the address
 * through its format check. No message names the address or the password.
 */
final class AdminAccount
{
    /** Reserved in shared/reserved-accounts.json, so nobody can register it first. */
    public const USERNAME = 'admin';

    public const NAME = 'Admin';

    public const MSG_CREATED = 'admin:create: account created (is_admin = 1).';

    public const MSG_REFUSED = 'admin:create: refused - an account with ADMIN_EMAIL or the username "admin" already exists; nothing was changed.';

    /**
     * Creates the account when the slot is empty.
     *
     * @return array{0: bool, 1: string} whether it was created, and the line to print
     */
    public static function create(mixed $email, mixed $password): array
    {
        $missing = array_keys(array_filter(
            ['ADMIN_EMAIL' => $email, 'ADMIN_PASSWORD' => $password],
            fn (mixed $value) => ! is_string($value) || $value === '',
        ));
        if ($missing !== []) {
            return [false, 'admin:create: '.implode(' and ', $missing).' must be set; no admin was created.'];
        }

        if (! ReservedAccounts::default()->isReservedUsername(self::USERNAME)) {
            return [false, 'admin:create: refused - the username "admin" is not reserved in shared/reserved-accounts.json; nothing was changed.'];
        }

        if (! EmailAddress::isValid($email)) {
            return [false, 'admin:create: ADMIN_EMAIL is not a valid e-mail address; no admin was created.'];
        }

        $problem = PasswordPolicy::problem($password, self::USERNAME, $email);
        if ($problem !== null) {
            return [false, "admin:create: ADMIN_PASSWORD does not meet the password rules ({$problem}); no admin was created."];
        }

        if (User::where('email', $email)->orWhere('username', self::USERNAME)->exists()) {
            return [false, self::MSG_REFUSED];
        }

        $user = new User;
        $user->name = self::NAME;
        $user->username = self::USERNAME;
        $user->email = $email;
        // Hashed here, not by the model's cast: the cast stores a value that already looks like a
        // hash as it is (AuthController::register).
        $user->password = Hash::make($password);
        // Not fillable (App\Models\User): admin rights are never set from request data.
        $user->forceFill(['is_admin' => true]);

        try {
            $user->save();
        } catch (UniqueConstraintViolationException) {
            // The unique keys on email and username: someone took the slot after the check.
            return [false, self::MSG_REFUSED];
        }

        return [true, self::MSG_CREATED];
    }
}
