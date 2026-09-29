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

/**
 * Die Kategorien der App.
 *
 * ## Die ersten zehn stehen fest
 *
 * Sie sind die Ursprungsliste (IDs 1–10). Nutzer:innen haben sie in ihrem Profil
 * ausgewaehlt und `activity_interest` zeigt darauf – umbenennen oder entfernen
 * hiesse, bestehende Auswahlen still zu veraendern. Deshalb wird hier nur
 * ANGEHAENGT, nie ersetzt.
 *
 * ## Warum die zweite Haelfte dazukam
 *
 * Die Ursprungsliste ist eine Hobby-Liste: „Musik", „Kunst & Design", „Kochen".
 * Fuer ein Profil reicht das, fuer ein Programm nicht. Als die 143 Termine des
 * Noergelbuff hereinkamen, landeten Konzerte, Salsa-Abende, Jazz-Sessions und
 * eine Comedy-Nacht alle in derselben Kategorie „Musik" – ein Regal mit 131
 * Eintraegen, in dem niemand etwas findet.
 *
 * Die Kategorien unten sind deshalb nach VERANSTALTUNGSART geschnitten und nicht
 * nach Hobby: Ein Tanzabend ist etwas anderes als ein Konzert, auch wenn bei
 * beiden Musik laeuft. Erst damit ergibt die Unterteilung der Listen einen Sinn
 * (siehe src/domain/interest-group.ts).
 *
 * `icon` ist der Slug, den src/domain/category-icon.ts kennt; ohne Treffer
 * entscheidet dort ein Stichwort aus dem Namen.
 */
const INTERESTS = [
  // --- Ursprungsliste, Reihenfolge und Namen nicht aendern (IDs 1-10) ---
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

  // --- Veranstaltungsarten ---
  { name: 'Konzerte', icon: 'konzert' },
  { name: 'Party & Club', icon: 'party' },
  { name: 'Tanzen', icon: 'tanz' },
  { name: 'Theater & Bühne', icon: 'theater' },
  { name: 'Comedy & Kabarett', icon: 'comedy' },
  { name: 'Lesung & Literatur', icon: 'lesung' },
  { name: 'Film & Kino', icon: 'film' },
  { name: 'Ausstellung & Museum', icon: 'ausstellung' },
  { name: 'Markt & Flohmarkt', icon: 'markt' },
  { name: 'Festival', icon: 'festival' },
  { name: 'Workshop & Kurs', icon: 'workshop' },
  { name: 'Vortrag & Bildung', icon: 'vortrag' },
  { name: 'Essen & Trinken', icon: 'essen' },
  { name: 'Natur & Wandern', icon: 'natur' },
  { name: 'Spieleabend', icon: 'spiel' },
  { name: 'Queer', icon: 'queer' },
  { name: 'Familie & Kinder', icon: 'familie' },
  { name: 'Studium & Campus', icon: 'studium' },
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

/**
 * Dauerangebote: Orte ohne festen Termin, an die man einfach hingehen kann.
 *
 * Sie liegen als `activities` mit `is_permanent = 1` in derselben Tabelle wie
 * die Termine – sie beantworten dieselbe Frage („was mache ich?") und sollen in
 * denselben Listen, Filtern und auf derselben Karte auftauchen. Warum das
 * Kennzeichen noetig ist und `starts_at` bei ihnen bedeutungslos bleibt, steht in
 * schema.sql.
 *
 * `hours` geht in die Beschreibung: Oeffnungszeiten sind das, was man bei einem
 * Dauerangebot wissen will, und ein eigenes Feld dafuer waere eine Spalte fuer
 * eine Handvoll Zeilen.
 *
 * Die Anschriften sind absichtlich knapp und ohne Hausnummer, wo ich sie nicht
 * belegen kann: Eine erfundene Hausnummer schickt Leute an die falsche Tuer, und
 * der Geocoder findet die Haeuser auch ueber Namen und Stadt (siehe
 * src/domain/place-query.ts).
 */
const PERMANENT = [
  {
    title: 'Bowling',
    location: 'Bowling-Center, Göttingen',
    description: 'Bahn buchen und losspielen – Schuhe gibt es vor Ort.',
    hours: 'Öffnungszeiten und Bahnen bitte vorher auf der Seite des Hauses prüfen.',
    interests: ['sport-radfahren', 'spieleabend'],
    host: { name: 'Bowling-Center Göttingen', username: 'bowling-goettingen' },
  },
  {
    title: 'House of Jumpers',
    location: 'House of Jumpers, Göttingen',
    description: 'Trampolinhalle: Sprungfelder, Airbag und Basketballkörbe.',
    hours: 'Öffnungszeiten und Zeitfenster bitte vorher auf der Seite des Hauses prüfen.',
    interests: ['fitness', 'familie-kinder'],
    host: { name: 'House of Jumpers', username: 'house-of-jumpers' },
  },
  {
    title: 'Freibad',
    location: 'Freibad, Göttingen',
    description: 'Schwimmen, liegen, Pommes. Im Sommer der einfachste Plan überhaupt.',
    hours: 'Saison und Öffnungszeiten bitte vorher auf der Seite des Bades prüfen.',
    interests: ['sport-radfahren', 'familie-kinder'],
    host: { name: 'Freibad Göttingen', username: 'freibad-goettingen' },
  },
];

/**
 * Legt ein Gastgeber-Konto fuer einen Ort an – oder findet es.
 *
 * Dieselbe Ueberlegung wie beim Import (src/import/store.js): eigenes
 * Business-Konto je Ort, damit in der App der Name des Hauses als Gastgeber steht
 * und sein Profil verlinkbar ist. Zufallspasswort, keine verifizierte Mail –
 * anmelden soll sich damit niemand.
 */
async function ensureVenueHost({ name, username }) {
  const email = `dauerangebot+${username}@goenntertainment.local`;
  const [found] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (found.length > 0) return found[0].id;

  const password = await hashPassword(
    `${username}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
  );
  const [res] = await pool.query(
    `INSERT INTO users (name, username, email, password, account_type, granted_account_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'business', 'business', NOW(), NOW())`,
    [name, username, email, password],
  );
  return res.insertId;
}

async function seedPermanent() {
  let neu = 0;
  let aktualisiert = 0;

  for (const entry of PERMANENT) {
    const hostId = await ensureVenueHost(entry.host);
    const description = `${entry.description}\n\n${entry.hours}`;

    // Ueber Titel UND Gastgeber gematcht: So laesst sich der Seed beliebig oft
    // laufen, ohne dass ein zweites Freibad entsteht.
    const [found] = await pool.query(
      'SELECT id FROM activities WHERE user_id = ? AND title = ? AND is_permanent = 1',
      [hostId, entry.title],
    );

    let activityId;
    if (found.length > 0) {
      activityId = found[0].id;
      await pool.query(
        'UPDATE activities SET description = ?, location = ?, updated_at = NOW() WHERE id = ?',
        [description, entry.location, activityId],
      );
      aktualisiert += 1;
    } else {
      // `starts_at` = jetzt, und der Wert ist BEDEUTUNGSLOS: Die Spalte darf nicht
      // leer sein, die App liest bei `is_permanent` kein Datum (siehe schema.sql).
      const [res] = await pool.query(
        `INSERT INTO activities
           (user_id, title, description, location, starts_at, is_permanent, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), 1, NOW(), NOW())`,
        [hostId, entry.title, description, entry.location],
      );
      activityId = res.insertId;
      neu += 1;
    }

    // Kategorien mit Rang: Der Index ist die Rangfolge, 0 = die fuehrende.
    const [rows] = await pool.query('SELECT id, slug FROM interests WHERE slug IN (?)', [
      entry.interests,
    ]);
    const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));
    const ids = entry.interests.map((s) => idBySlug.get(s)).filter((id) => id !== undefined);

    await pool.query('DELETE FROM activity_interest WHERE activity_id = ?', [activityId]);
    if (ids.length > 0) {
      await pool.query('INSERT INTO activity_interest (activity_id, interest_id, `rank`) VALUES ?', [
        ids.map((id, index) => [activityId, id, index]),
      ]);
    }
  }

  console.log(`Dauerangebote: ${neu} neu, ${aktualisiert} aktualisiert.`);
}

async function main() {
  try {
    await ensureSchema();
    await seedInterests();
    await seedPermanent();
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
