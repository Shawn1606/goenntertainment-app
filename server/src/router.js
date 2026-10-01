/**
 * The one way to make a router here: case-sensitive and strict (F-01).
 *
 * Express routers match case-insensitively and ignore a trailing slash by default, so `/api/User`
 * or `/api/user/` reached the same handler as `/api/user`. Laravel (api/) matches case-sensitively
 * and forwards every path to Node in a single, normalised spelling (lower-case, no repeated or
 * trailing slashes; api/app/Http/Controllers/NodeFallbackController.php). Node accepts that one
 * spelling and nothing else. app.js sets the same two options for the app itself, which covers
 * the mount prefixes. test/routing.test.js checks that every router file uses this function.
 */
import { Router } from 'express';

export const createRouter = () => Router({ caseSensitive: true, strict: true });
