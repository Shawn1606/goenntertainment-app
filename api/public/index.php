<?php

use App\Http\Middleware\LimitRequestBody;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Refuse a request body over the limits before Laravel reads it (F-02): Request::capture() below
// decodes a JSON body completely, before the first middleware runs. Only the server variables
// are read here, and at most limit + 1 bytes of the body (App\Http\Middleware\LimitRequestBody).
if (LimitRequestBody::exceedsLimit(new SymfonyRequest(server: $_SERVER))) {
    LimitRequestBody::tooLarge()->send();

    exit;
}

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
