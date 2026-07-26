import 'dotenv/config';
import { pool } from './db.js';
import { hashPassword } from './auth.js';

/**
 * Fuellt die DB mit den Start-Daten (portiert aus den Laravel-Seedern):
 *  - Interessen-Liste (InterestSeeder)
 *  - Admin-Account fuer das Admin-Panel (AdminUserSeeder), nur wenn ADMIN_* gesetzt
 *
 * Idempotent: laesst sich beliebig oft ausfuehren, ohne Duplikate.
 * Aufruf:  npm run seed     (im Ordner server/)
 */

/** Wie Laravels Str::slug: klein, Sonderzeichen -> '-', Raender getrimmt. */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Akzente entfernen
    .replace(/[^a-z0-9]+/g, '-') // alles Uebrige -> Bindestrich
    .replace(/^-+|-+$/g, ''); // Raender trimmen
}

const INTERESTS = [
  { name: 'Sport & Radfahren', icon: 'bike' },
  { name: 'Soziales & Community', icon: 'people' },
  { name: 'Basketball', icon: 'basketball' },
  { name: 'Fotografie', icon: 'camera' },
  { name: 'Musik', icon: 'music' },
  { name: 'Gaming', icon: 'gaming' },
  { name: 'Reisen', icon: 'travel' },
  { name: 'Kochen', icon: 'cooking' },
  { name: 'Kunst & Design', icon: 'art' },
  { name: 'Fitness', icon: 'fitness' },
];

async function seedInterests() {
  for (const interest of INTERESTS) {
    const slug = slugify(interest.name);
    // updateOrCreate per slug: vorhandene Zeile aktualisieren, sonst anlegen.
    await pool.query(
      `INSERT INTO interests (name, slug, icon, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE name = VALUES(name), icon = VALUES(icon), updated_at = NOW()`,
      [interest.name, slug, interest.icon],
    );
  }
  console.log(`Interessen: ${INTERESTS.length} eingespielt/aktualisiert.`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('Admin: uebersprungen (ADMIN_EMAIL/ADMIN_PASSWORD nicht gesetzt).');
    return;
  }

  // Wie Laravels updateOrCreate: nur ueber die E-Mail matchen.
  const hashed = await hashPassword(String(password));
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

  if (existing.length > 0) {
    await pool.query(
      `UPDATE users
          SET name = 'Admin', username = 'admin', password = ?, account_type = 'personal', updated_at = NOW()
        WHERE id = ?`,
      [hashed, existing[0].id],
    );
    console.log(`Admin: Konto fuer ${email} aktualisiert.`);
  } else {
    await pool.query(
      `INSERT INTO users (name, username, email, password, account_type, created_at, updated_at)
         VALUES ('Admin', 'admin', ?, ?, 'personal', NOW(), NOW())`,
      [email, hashed],
    );
    console.log(`Admin: Konto fuer ${email} angelegt.`);
  }
}

async function main() {
  try {
    await seedInterests();
    await seedAdmin();
    console.log('Seed fertig.');
  } catch (err) {
    console.error('Seed fehlgeschlagen:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
