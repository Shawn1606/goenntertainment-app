/**
 * Baut die Express-App zusammen – ohne sie zu starten.
 *
 * Bewusst getrennt von index.js (dort passiert nur noch listen/Setup): so kann
 * ein Test die App auf einem freien Port hochziehen, ohne einen zweiten Prozess
 * zu starten (siehe server/test/api.test.js).
 */
import path from 'node:path';
import express from 'express';
import { pool } from './db.js';
import { HttpError } from './validate.js';
import { internalSecret as internalSecretSetting } from './config.js';
import interestsRouter from './routes/interests.js';
import authRouter from './routes/auth.js';
import passwordRouter from './routes/password.js';
import activitiesRouter from './routes/activities.js';
import adminRouter from './routes/admin.js';
import progressRouter from './routes/progress.js';
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

/**
 * Options (tests pass them; the server reads its environment, see config.js):
 *   internalSecret  shared secret for the internal routes (default NODE_INTERNAL_SECRET)
 */
export function createApp({ internalSecret = internalSecretSetting() } = {}) {
  const app = express();

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
   */
  app.set('trust proxy', 1);

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

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Banner-Bilder oeffentlich ausliefern (wie Laravels /storage)
  app.use('/storage', express.static(path.join(process.cwd(), 'storage')));

  // Health-Check
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  // Internal routes for Laravel and the container health check; never forwarded from outside
  // (Laravel forwards only /api paths). Unknown internal paths get the same JSON 404.
  app.use('/internal', internalRouter({ secret: internalSecret }));
  app.use('/internal', (req, res) => res.status(404).json({ message: 'Nicht gefunden.' }));

  // Routen (gleiche Pfade wie das alte Laravel-Backend)
  app.use('/api', authRouter); // /register, /login, /logout, /user
  app.use('/api', passwordRouter); // /forgot-password, /reset-password
  app.use('/api', progressRouter); // /me/progress, /leaderboard
  app.use('/api/interests', interestsRouter);
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
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ message: err.message, errors: err.errors });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(422).json({
        message: 'Das Banner-Bild darf hoechstens 5 MB gross sein.',
        errors: { banner: ['Das Banner-Bild darf hoechstens 5 MB gross sein.'] },
      });
    }
    console.error(err);
    return res.status(500).json({ message: 'Serverfehler.' });
  });

  return app;
}
