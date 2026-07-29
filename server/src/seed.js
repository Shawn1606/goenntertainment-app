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

/**
 * Ruestet Spalten nach, die spaeter dazukamen (fuer DBs, die vor der Schema-
 * Aenderung angelegt wurden). Idempotent: prueft erst information_schema, damit es
 * auf MySQL wie MariaDB laeuft (MySQL kennt kein `ADD COLUMN IF NOT EXISTS`).
 */
async function ensureSchema() {
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'is_admin'`,
  );
  if (col[0].length === 0) {
    await pool.query(
      "ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER password",
    );
    console.log('Schema: Spalte users.is_admin nachgeruestet.');
  }

  const banCol = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'banned_until'`,
  );
  if (banCol[0].length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN banned_until DATETIME NULL AFTER is_admin');
    console.log('Schema: Spalte users.banned_until nachgeruestet.');
  }

  const reasonCol = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'ban_reason'`,
  );
  if (reasonCol[0].length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN ban_reason VARCHAR(255) NULL AFTER banned_until');
    console.log('Schema: Spalte users.ban_reason nachgeruestet.');
  }

  const maxCol = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'activities' AND column_name = 'max_participants'`,
  );
  if (maxCol[0].length === 0) {
    await pool.query(
      'ALTER TABLE activities ADD COLUMN max_participants INT UNSIGNED NULL AFTER banner_path',
    );
    console.log('Schema: Spalte activities.max_participants nachgeruestet.');
  }

  // Beweismittel-Tabelle (Bild-Beweise je Sperre) – fuer bestehende DBs nachziehen.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ban_evidence (
       id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       user_id      BIGINT UNSIGNED NOT NULL,
       admin_id     BIGINT UNSIGNED NULL,
       action       VARCHAR(20)     NOT NULL,
       reason       VARCHAR(255)    NOT NULL,
       banned_until DATETIME        NULL,
       image_path   VARCHAR(255)    NULL,
       created_at   TIMESTAMP       NULL,
       PRIMARY KEY (id),
       KEY ban_evidence_user_id_idx (user_id),
       CONSTRAINT ban_evidence_user_id_fk
         FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
       CONSTRAINT ban_evidence_admin_id_fk
         FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

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
    // `COALESCE` statt fest 'business_plus': Ein erneuter Seed-Lauf soll die
    // eingestellte Kontostufe nicht zurueckdrehen – wer zum Pruefen auf
    // Standard gewechselt ist, bleibt dort.
    await pool.query(
      `UPDATE users
          SET name = 'Admin', username = 'admin', password = ?,
              account_type = COALESCE(account_type, 'business_plus'), is_admin = 1, updated_at = NOW()
        WHERE id = ?`,
      [hashed, existing[0].id],
    );
    console.log(`Admin: Konto fuer ${email} aktualisiert (is_admin = 1).`);
  } else {
    // Hoechste Stufe: So sieht das Admin-Konto von Anfang an alles (inkl.
    // Business-Bereich) und kann zum Pruefen nach unten wechseln.
    await pool.query(
      `INSERT INTO users (name, username, email, password, account_type, is_admin, created_at, updated_at)
         VALUES ('Admin', 'admin', ?, ?, 'business_plus', 1, NOW(), NOW())`,
      [email, hashed],
    );
    console.log(`Admin: Konto fuer ${email} angelegt (is_admin = 1).`);
  }
}

async function main() {
  try {
    await ensureSchema();
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
