/**
 * Baut die Express-App zusammen – ohne sie zu starten.
 *
 * Bewusst getrennt von index.js (dort passiert nur noch listen/Setup): so kann
 * ein Test die App auf einem freien Port hochziehen, ohne einen zweiten Prozess
 * zu starten (siehe server/test/api.test.js).
 */
import path from 'node:path';
import express from 'express';
import { HttpError } from './validate.js';
import { clientErrorFor } from './client-errors.js';
import { logError } from './log.js';
import { internalSecret as internalSecretSetting, trustProxySetting } from './config.js';
import activitiesRouter from './routes/activities.js';
import adminRouter from './routes/admin.js';
import businessRouter from './routes/business.js';
import profileRouter from './routes/profile.js';
import rewardsRouter from './routes/rewards.js';
import storiesRouter from './routes/stories.js';
import friendsRouter from './routes/friends.js';
import groupsRouter from './routes/groups.js';
import chatRouter from './routes/chat.js';
import reportsRouter from './routes/reports.js';
import upgradesRouter from './routes/upgrades.js';
import notificationsRouter from './routes/notifications.js';
import revenueCatRouter from './routes/revenuecat.js';
import { internalRouter } from './routes/internal.js';

/** Largest JSON body (F-02). */
export const JSON_LIMIT = '32kb';
/** Largest JSON body of the RevenueCat webhook (see the body parsers below). */
export const WEBHOOK_JSON_LIMIT = '128kb';
/** Largest urlencoded body and its number of fields (F-02). */
export const URLENCODED_LIMIT = '16kb';
export const PARAMETER_LIMIT = 50;

/**
 * Options (tests pass them; the server reads its environment, see config.js):
 *   trustProxy      whose forwarding headers count, Express 'trust proxy' syntax
 *                   (default NODE_TRUST_PROXY; see trustProxySetting)
 *   internalSecret  shared secret for the internal routes (default NODE_INTERNAL_SECRET)
 */
export function createApp({ trustProxy = trustProxySetting(), internalSecret = internalSecretSetting() } = {}) {
  const app = express();

  // One spelling per path, like the routers (src/router.js explains why). These must be set
  // before the first app.use: Express builds the app's own router lazily from them.
  app.set('case sensitive routing', true);
  app.set('strict routing', true);

  /**
   * Hinter einem Reverse Proxy (nginx/Traefik in Produktion) steht in
   * `req.protocol` sonst 'http' – denn der Proxy spricht per Klartext mit Node,
   * das TLS endet eine Schicht davor. Genau dieser Wert baut in media.js die
   * Bild-Adressen. Ohne diese Zeile liefert das Backend also `http://...`-URLs,
   * und die App zeigt KEIN einziges Bild mehr: iOS (App Transport Security) und
   * Android 9+ verbieten Klartext-HTTP im Release-Build. Mit 'trust proxy'
   * liest Express `X-Forwarded-Proto` und gibt 'https' zurueck.
   *
   * In der Entwicklung (kein Proxy, kein X-Forwarded-Proto) aendert das nichts.
   *
   * Trusted is exactly one hop, Laravel (F-31): `trust proxy 1` used to believe whatever peer
   * came first, so anyone who reached Node could choose the address in `req.ip`. Now
   * X-Forwarded-For/-Proto/-Host count only from the configured address (config.js
   * trustProxySetting), and `req.ip` is the client address Laravel passes on - the key for
   * per-address rate limits. From any other peer `req.ip` is that peer.
   */
  app.set('trust proxy', trustProxy);

  /**
   * CORS. Ohne diese Header ist die App im BROWSER komplett blind: Der
   * Web-Zielbau laeuft unter localhost:8081/8082, das Backend unter
   * localhost:8000 – zwei verschiedene Origins. Der `Authorization`-Header macht
   * aus jedem Aufruf eine Anfrage mit Vorabfrage (OPTIONS), und die lief hier
   * ins Leere. Auf dem Handy fiel das nie auf, weil React Native kein CORS kennt.
   *
   * `*` ist hier bewusst und sicher: Dieses Backend authentifiziert
   * ausschliesslich ueber einen Bearer-Token im Header, nicht ueber Cookies. Der
   * Browser schickt Header nie von allein mit – eine fremde Seite kann also
   * nichts im Namen der Nutzer:in tun, egal welche Origin erlaubt ist. Genau
   * deshalb steht hier auch KEIN `Access-Control-Allow-Credentials`: Mit
   * Cookies waere `*` tatsaechlich ein Loch.
   */
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
    // Eine Vorabfrage darf 24 h gelten – sonst fragt der Browser vor jedem
    // einzelnen Aufruf erneut nach.
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  /**
   * Request bodies (F-02): small limits and flat forms. The largest JSON body the app sends (a
   * group with its members, the social links) is a few kilobytes. Nothing sends urlencoded bodies
   * (src/lib/api.ts sends JSON or multipart), so that parser stays small and flat: no nesting
   * (`extended: false`), at most PARAMETER_LIMIT fields. Multipart forms are bounded per route in
   * uploads.js. The RevenueCat webhook gets its own, larger JSON limit (mounted first, so the
   * general parser leaves its body alone): the store's event carries the subscriber's attributes,
   * and their size is not the app's to choose.
   * An unreadable or oversized body is answered with 400/413/415 (client-errors.js), not 500.
   */
  app.use('/api/webhooks/revenuecat', express.json({ limit: WEBHOOK_JSON_LIMIT }));
  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: URLENCODED_LIMIT, parameterLimit: PARAMETER_LIMIT }));

  // Banner-Bilder oeffentlich ausliefern (wie Laravels /storage)
  app.use('/storage', express.static(path.join(process.cwd(), 'storage')));

  // Internal routes for Laravel and the container health check (GET /internal/health); never
  // forwarded from outside (Laravel forwards only /api paths). Unknown internal paths get the
  // same JSON 404.
  app.use('/internal', internalRouter({ secret: internalSecret }));
  app.use('/internal', (req, res) => res.status(404).json({ message: 'Nicht gefunden.' }));

  // Routen. One owner per path: what Laravel (api/) serves is not served here - sign-up,
  // sign-in, the own account, progress, leaderboard, interests and /api/health are Laravel's
  // (api/routes/api.php). api/tests/Feature/NodeTwinRoutesTest.php checks that no path below is
  // one of Laravel's.
  app.use('/api/activities', activitiesRouter);
  app.use('/api/admin', adminRouter); // /stats, /users, /stories, /upgrade-requests, /evidence, /moderation (nur Admin)
  app.use('/api/business', businessRouter); // /insights, /activities/:id/boost (ab Business)
  app.use('/api', rewardsRouter); // /me/rewards, /me/rewards/redeem (Praemien)
  app.use('/api', storiesRouter); // /stories (+ /:id/view) – Storys ab Creator
  app.use('/api', friendsRouter); // /friends, /blocks (Freunde-Bereich)
  app.use('/api', groupsRouter); // /groups (+ /:id/members) – Gruppen
  app.use('/api', chatRouter); // /chats (+ /:kind/:refId/messages) – Gruppen- und Event-Chats
  // /reports fuer alle, /admin/reports nur fuer Admins – beides in einer Datei,
  // weil es dieselbe Sache von zwei Seiten ist.
  app.use('/api', reportsRouter);
  app.use('/api', upgradesRouter); // /me/upgrade-request – Kontostufe anfragen
  app.use('/api', notificationsRouter); // /notifications (+ /read) – Glocke
  // /webhooks/revenuecat (Store meldet Kauf/Ablauf), /me/subscription (eigener Stand)
  app.use('/api', revenueCatRouter);
  // /users, /users/:username (+ /followers, /following, /follow), /posts
  // (+ /like, /comments), /comments/:id, /me/links, /me/avatar, /me/banner
  app.use('/api', profileRouter);

  // 404 fuer unbekannte API-Pfade
  app.use('/api', (req, res) => res.status(404).json({ message: 'Nicht gefunden.' }));

  // Zentrale Fehlerbehandlung -> immer JSON im Laravel-Format
  app.use(handleError);

  return app;
}

/**
 * The central error handler (exported for test/logging.test.js).
 *
 * - HttpError: the route's own status and message.
 * - A client error from the body parser or multer (client-errors.js): 400/413/415, not logged.
 * - Anything else: 500, logged through log.js - name, codes and the route pattern, never the
 *   request body, SQL text or a driver message (F-38).
 */
export function handleError(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  const client = clientErrorFor(err);
  if (client) {
    return res.status(client.status).json({ message: client.message });
  }
  logError('request failed', err, req);
  return res.status(500).json({ message: 'Serverfehler.' });
}
