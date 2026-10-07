<?php

namespace App\Http\Responses;

use Illuminate\Http\JsonResponse;

/**
 * A JSON answer that the client has completely before the request's deferred work runs
 * (Laravel's defer(), which runs after the response is sent).
 *
 * The api image runs PHP inside Apache (php:8.4-apache, mod_php). There, Symfony's send() has no
 * fastcgi_finish_request(): it writes the body, flushes and returns, and Laravel then runs the
 * deferred work before the request ends. Without a stated length Apache sends the body in chunks
 * and the final chunk only when the request ends, so the client (and Caddy in front of Apache)
 * waits for the deferred work as well. With the exact Content-Length the body ends at the flush.
 *
 * Connection: close keeps the next request off this connection: Apache serves a connection one
 * request at a time, and a request queued behind the deferred work would wait for it, and could
 * time it. ignore_user_abort: once the client has the whole answer it may close its end; the
 * deferred work must still run to its end.
 *
 * The length is taken in send(), after every middleware has had the response: one of them
 * encodes the JSON again (UnescapedJsonResponses).
 */
class LengthDelimitedJsonResponse extends JsonResponse
{
    public function send(bool $flush = true): static
    {
        $content = $this->getContent();
        if (is_string($content) && ! $this->headers->has('Transfer-Encoding')) {
            $this->headers->set('Content-Length', (string) strlen($content));
        }
        $this->headers->set('Connection', 'close');
        ignore_user_abort(true);

        return parent::send($flush);
    }
}
