<?php

namespace Tests\Unit;

use App\Support\Sessions;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

/**
 * SANCTUM_EXPIRATION: unset means 30 days; only a positive whole number of minutes is accepted.
 * Sanctum reads 0 and null as "never expires", so nothing may turn into either.
 */
class SessionsLifetimeTest extends TestCase
{
    public function test_unset_or_empty_means_the_default_of_30_days(): void
    {
        $this->assertSame(43200, Sessions::DEFAULT_LIFETIME_MINUTES);
        $this->assertSame(43200, Sessions::lifetimeFromEnv(null));
        $this->assertSame(43200, Sessions::lifetimeFromEnv(''));
    }

    public function test_a_positive_whole_number_of_minutes_is_taken(): void
    {
        $this->assertSame(60, Sessions::lifetimeFromEnv('60'));
        $this->assertSame(1440, Sessions::lifetimeFromEnv(' 1440 '));
        $this->assertSame(5, Sessions::lifetimeFromEnv(5));
    }

    public function test_anything_else_stops_the_configuration(): void
    {
        foreach (['0', '-5', 'abc', '1.5', '60m', '00', '99999999', 0, -1, 1.5, true, false, []] as $bad) {
            try {
                Sessions::lifetimeFromEnv($bad);
                $this->fail('accepted '.json_encode($bad));
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
