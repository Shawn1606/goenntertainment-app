<?php

namespace Tests\Feature;

use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use ReflectionProperty;
use Tests\AppFeatureTestCase;

/**
 * The rate limiter counts in the database cache store, on the `cache` table of server/schema.sql,
 * as the deploy runs it (CACHE_STORE=database). Its counters therefore hold across requests that
 * land in different PHP workers and survive a restart of the api container.
 * tests/Unit/DeployCacheStoreTest.php checks the deploy setting and the schema.
 */
class CacheStoreTest extends AppFeatureTestCase
{
    public function test_the_rate_limiter_uses_the_database_store(): void
    {
        $this->assertSame('database', config('cache.default'));

        $cache = new ReflectionProperty(RateLimiter::class, 'cache');
        $store = $cache->getValue(app(RateLimiter::class))->getStore();

        $this->assertInstanceOf(DatabaseStore::class, $store);
        $this->assertSame('cache', (new ReflectionProperty(DatabaseStore::class, 'table'))->getValue($store));
    }

    public function test_a_limiter_hit_is_a_row_in_the_cache_table(): void
    {
        $before = DB::table('cache')->count();

        app(RateLimiter::class)->hit('cache-store-probe', 60);
        app(RateLimiter::class)->hit('cache-store-probe', 60);

        // The counter and its timer: two rows, the counter at 2.
        $this->assertSame($before + 2, DB::table('cache')->count());
        $this->assertSame(2, app(RateLimiter::class)->attempts('cache-store-probe'));
        $this->assertSame(2, (int) Cache::store('database')->get('cache-store-probe'));
    }
}
