import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { pool } from './db.js';
import { HttpError } from './validate.js';
import interestsRouter from './routes/interests.js';
import authRouter from './routes/auth.js';
import passwordRouter from './routes/password.js';
import googleRouter from './routes/google.js';
import activitiesRouter from './routes/activities.js';

const app = express();
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

// Routen (gleiche Pfade wie das alte Laravel-Backend)
app.use('/api', authRouter); // /register, /login, /logout, /user
app.use('/api', passwordRouter); // /forgot-password, /reset-password
app.use('/api/auth', googleRouter); // /auth/google
app.use('/api/interests', interestsRouter);
app.use('/api/activities', activitiesRouter);

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

const port = Number(process.env.PORT ?? 8000);
app.listen(port, '0.0.0.0', () => {
  console.log(`Goenntertainment-Backend laeuft auf http://0.0.0.0:${port}`);
});
