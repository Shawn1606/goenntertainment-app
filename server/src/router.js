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

/**
 * Remembers where the router is mounted (`req.baseUrl` inside it: the literal mount path from
 * app.js) for the log line of a failed request (log.js): at the central error handler `req.baseUrl`
 * is the app's again, and the URL itself is never logged.
 */
function rememberMount(req, res, next) {
  req.routeMount = req.baseUrl;
  next();
}

export const createRouter = () => {
  const router = Router({ caseSensitive: true, strict: true });
  router.use(rememberMount);
  return router;
};
