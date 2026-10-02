<?php

namespace App\Http\Middleware;

use App\Support\RateLimitRules;
use Closure;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * Laravel's `throttle` middleware, with the check and the count of each counter as ONE step.
 *
 * The stock middleware first checks every limit of a request and then counts the request on each.
 * Requests that arrive at the same time all pass the check before any of them is counted, so a
 * burst gets about as many requests past a limit as there are PHP workers - and the per-account
 * caps of the sign-in, sign-up, password and two-factor routes are exactly the limits a burst is
 * aimed at. Here a request takes one lock per counter, checks, counts and lets go again before
 * the controller runs, so requests that share a counter take turns and every limit is exact.
 *
 * The locks live in the limiter's cache store (the database in the deploy: table cache_locks), so
 * they hold across PHP processes and containers. They are taken in a fixed order (sorted by key),
 * so two requests never wait for each other in a circle. A request that cannot get them in time
 * (config ratelimits.lock-wait, 5 s by default) is answered like one over the limit (429), and
 * nothing was counted.
 *
 * Registered as the `throttle` alias (bootstrap/app.php), so every `throttle:<limiter>` route
 * uses it; tests/Feature/RouteThrottleCoverageTest.php checks that.
 */
class ThrottleRequestsExactly extends ThrottleRequests
{
    /** A lock ends by itself after this long if its holder dies (seconds). */
    private const LOCK_SECONDS = 10;

    /** Pause between two tries to get a lock (milliseconds). */
    private const LOCK_RETRY_MS = 50;

    /**
     * As in the parent, except that the check and the count happen under the counters' locks.
     *
     * @param  Request  $request
     * @return Response
     */
    protected function handleRequest($request, Closure $next, array $limits)
    {
        $this->checkAndCount($request, $limits);

        $response = $next($request);

        foreach ($limits as $limit) {
            // A limit counted only after the answer (Limit::after) keeps the stock order; none of
            // this app's limiters uses one.
            if ($limit->afterCallback && ($limit->afterCallback)($response)) {
                $this->limiter->hit($limit->key, $limit->decaySeconds);
            }

            $response = $this->addHeaders(
                $response,
                $limit->maxAttempts,
                $this->calculateRemainingAttempts($limit->key, $limit->maxAttempts)
            );
        }

        return $response;
    }

    /**
     * Refuses the request if any limit is reached, otherwise counts it on every limit - all while
     * holding the lock of every counter involved.
     *
     * @param  Request  $request
     */
    private function checkAndCount($request, array $limits): void
    {
        $keys = array_values(array_unique(array_map(static fn (object $limit): string => $limit->key, $limits)));
        sort($keys);

        /** @var list<Lock> $held */
        $held = [];
        $deadline = microtime(true) + RateLimitRules::lockWaitSeconds();
        try {
            foreach ($keys as $key) {
                $lock = Cache::store(config('cache.limiter'))
                    ->lock('throttle:'.$key, self::LOCK_SECONDS)
                    ->betweenBlockedAttemptsSleepFor(self::LOCK_RETRY_MS);
                // One wait for all of the request's locks, not one per lock.
                $lock->block(max(0.001, $deadline - microtime(true)));
                $held[] = $lock;
            }

            foreach ($limits as $limit) {
                if ($this->limiter->tooManyAttempts($limit->key, $limit->maxAttempts)) {
                    throw $this->buildException($request, $limit->key, $limit->maxAttempts, $limit->responseCallback);
                }
            }

            foreach ($limits as $limit) {
                if (! $limit->afterCallback) {
                    $this->limiter->hit($limit->key, $limit->decaySeconds);
                }
            }
        } catch (LockTimeoutException) {
            $limit = reset($limits);

            throw $this->buildException($request, $limit->key, $limit->maxAttempts, $limit->responseCallback);
        } finally {
            foreach (array_reverse($held) as $lock) {
                $lock->release();
            }
        }
    }
}
