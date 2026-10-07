<?php

namespace Tests\Feature;

use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Laravel registers no route under /storage (F-29: uploads are static files served by the edge,
 * never by PHP).
 *
 * A filesystem disk with 'serve' => true makes Laravel register GET|HEAD storage/{path} and
 * PUT storage/{path} (signed URLs) for it. The app keeps nothing on Laravel's disks, so such a
 * route would only be a second way into /storage, and the PUT an unthrottled write. The whole
 * route table and every configured disk are checked, not only the two route names.
 */
class StorageRoutesTest extends TestCase
{
    public function test_local_disk_routes_are_not_registered(): void
    {
        $this->assertFalse(Route::has('storage.local'), 'GET|HEAD storage/{path} of the local disk is registered');
        $this->assertFalse(Route::has('storage.local.upload'), 'PUT storage/{path} of the local disk is registered');
    }

    public function test_no_route_is_registered_under_storage(): void
    {
        $routes = Route::getRoutes()->getRoutes();
        $this->assertNotEmpty($routes, 'the route table is empty: nothing was checked');

        $underStorage = array_values(array_map(
            static fn (RoutingRoute $route): string => implode('|', $route->methods()).' '.$route->uri(),
            array_filter(
                $routes,
                static fn (RoutingRoute $route): bool => preg_match('#^/*storage(/|$)#i', $route->uri()) === 1,
            ),
        ));

        $this->assertSame([], $underStorage, 'routes under /storage (checked '.count($routes).' routes)');
    }

    public function test_no_disk_serves_its_files(): void
    {
        $disks = (array) config('filesystems.disks');
        $this->assertNotEmpty($disks, 'no filesystem disk is configured: nothing was checked');

        $serving = array_keys(array_filter(
            $disks,
            static fn ($disk): bool => is_array($disk) && (bool) ($disk['serve'] ?? false),
        ));

        $this->assertSame([], $serving, 'disks with serve => true (checked '.count($disks).' disks)');
    }
}
