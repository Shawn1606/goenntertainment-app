/**
 * Der Teil des Imports, der die Datenbank anfasst: Gastgeber-Konto je Location,
 * Merkzettel der schon importierten Events, und der Upsert selbst.
 *
 * Leitgedanke ist Idempotenz: Der Import soll beliebig oft laufen duerfen
 * (Cronjob) und beim zweiten Lauf ohne Aenderungen an der Quelle GAR NICHTS
 * tun. Dafuer braucht es zwei Dinge – einen stabilen Schluessel je Event und
 * einen Fingerabdruck des Inhalts (beides in normalize.js).
 */
import { pool, first } from '../db.js';
import { findSystemAccount, systemAccountPasswordHash } from '../system-accounts.js';

/**
 * Merkzettel: welches Event der Quelle wurde zu welcher Aktivitaet.
 *
 * Warum eine eigene Tabelle und kein Feld in `activities`: Die Zuordnung ist
 * eine Aussage ueber die HERKUNFT, nicht ueber das Event. `activities` bleibt
 * damit genau die Tabelle, die die App kennt – nichts in der App muss vom
 * Import wissen.
 *
 * `activity_id` ist ON DELETE SET NULL und nicht CASCADE: Loescht ein Admin ein
 * importiertes Event, bleibt die Zeile mit activity_id NULL zurueck. Das ist
 * das Gedaechtnis dafuer, dass es weg soll – der naechste Lauf legt es nicht
 * wieder an (siehe upsertEvent).
 */
export async function ensureImportSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imported_events (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source       VARCHAR(64)     NOT NULL,           -- slug aus sources.js
      external_id  VARCHAR(255)    NOT NULL,           -- ID in der Quelle
      activity_id  BIGINT UNSIGNED NULL,               -- NULL = vom Admin entfernt, nicht neu anlegen
      content_hash CHAR(8)         NOT NULL,           -- Fingerabdruck, siehe normalize.js
      source_url   VARCHAR(512)    NULL,
      last_seen_at DATETIME        NULL,               -- zuletzt in der Quelle gesehen
      created_at   TIMESTAMP       NULL,
      updated_at   TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY imported_events_source_external_uq (source, external_id),
      KEY imported_events_activity_id_idx (activity_id),
      CONSTRAINT imported_events_activity_id_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/**
 * Legt das Konto an, unter dem die Events einer Location laufen – oder findet es.
 *
 * Jede Location bekommt ihr eigenes Business-Konto statt eines Sammel-Kontos
 * "Import": In der App steht damit der Name des Hauses als Gastgeber, das
 * Profil ist verlinkbar (account_type != 'standard', siehe transform() in
 * routes/activities.js), und wenn die Location spaeter selbst uebernehmen will,
 * gibt man ihr einfach das Passwort zurueck – die Events bleiben, wo sie sind.
 *
 * Das Konto hat ein Zufallspasswort und keine verifizierte Mail: Anmelden soll
 * sich damit niemand, es traegt nur die Events.
 *
 * An existing account is taken over only when it is exactly the host's account (same address,
 * expected username; see src/system-accounts.js). An account that merely matches the way the
 * database compares addresses, e.g. one with an accented letter in the domain, is refused with
 * SystemAccountConflict before anything is written, and the import run stops with exit code 1.
 */
export async function ensureVenueHost(source) {
  const existingId = await findSystemAccount(pool, source.host);
  if (existingId !== null) {
    // account_type nachziehen, falls das Konto aus einer frueheren Fassung stammt.
    await pool.query(
      `UPDATE users SET granted_account_type = 'business',
              account_type = COALESCE(NULLIF(account_type, 'standard'), 'business'),
              updated_at = NOW()
        WHERE id = ?`,
      [existingId],
    );
    return existingId;
  }

  // Kein festes Passwort im Quelltext: Das Konto soll nicht anmeldbar sein.
  // The bcrypt hash of a secret from node:crypto that is never printed or kept (src/system-accounts.js).
  const password = await systemAccountPasswordHash();

  const [result] = await pool.query(
    `INSERT INTO users (name, username, email, password, account_type, granted_account_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'business', 'business', NOW(), NOW())`,
    [source.name, source.host.username, source.host.email, password],
  );
  return result.insertId;
}

/**
 * Interessen-IDs zu den Slugs, die der Normalizer vorschlaegt – IN DERSELBEN
 * REIHENFOLGE.
 *
 * Das ist der Punkt: `SELECT ... WHERE slug IN (?)` gibt die Zeilen in der
 * Reihenfolge zurueck, die der Datenbank gerade passt, nicht in der der Liste.
 * Da der Index spaeter zum Rang wird (siehe setInterests), waere die fuehrende
 * Kategorie damit ausgewuerfelt – und ein Salsa-Abend landete mal unter "Tanzen",
 * mal unter "Konzerte".
 *
 * Nicht gefundene Slugs fallen still heraus: Eine Regel darf auf eine Kategorie
 * zeigen, die noch nicht eingespielt ist, ohne den Import abzubrechen.
 */
export async function interestIdsForSlugs(slugs) {
  if (slugs.length === 0) return [];
  const [rows] = await pool.query('SELECT id, slug FROM interests WHERE slug IN (?)', [slugs]);
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));
  return slugs.map((slug) => idBySlug.get(slug)).filter((id) => id !== undefined);
}

/**
 * Setzt die Kategorien eines Events – mit ihrer RANGFOLGE.
 *
 * Der Index ist der Rang: 0 ist die fuehrende Kategorie, und nach ihr unterteilt
 * die App ihre Listen. Ohne den Rang entschied beim Auslesen das Alphabet, und
 * die Absicht von INTEREST_RULES (spezifisch vor allgemein) war verloren.
 */
async function setInterests(activityId, interestIds) {
  await pool.query('DELETE FROM activity_interest WHERE activity_id = ?', [activityId]);
  if (interestIds.length === 0) return;

  await pool.query('INSERT INTO activity_interest (activity_id, interest_id, `rank`) VALUES ?', [
    interestIds.map((interestId, index) => [activityId, interestId, index]),
  ]);
}

/**
 * Schreibt EIN normalisiertes Event.
 *
 * Gibt zurueck, was passiert ist – 'created' | 'updated' | 'unchanged' |
 * 'removed'. Das CLI zaehlt nur diese Ergebnisse zusammen; so ist nach einem
 * Lauf in einer Zeile zu sehen, ob die Quelle sich bewegt hat.
 */
export async function upsertEvent(event, hostId, { dryRun = false } = {}) {
  const known = await first(
    'SELECT id, activity_id, content_hash FROM imported_events WHERE source = ? AND external_id = ?',
    [event.source, event.externalId],
  );

  // Vom Admin entfernt: Merkzettel-Zeile ohne Aktivitaet. Nicht wieder anlegen.
  if (known && known.activity_id === null) {
    if (!dryRun) {
      await pool.query('UPDATE imported_events SET last_seen_at = NOW() WHERE id = ?', [known.id]);
    }
    return 'removed';
  }

  if (known && known.content_hash === event.contentHash) {
    if (!dryRun) {
      await pool.query('UPDATE imported_events SET last_seen_at = NOW() WHERE id = ?', [known.id]);
    }
    return 'unchanged';
  }

  if (dryRun) return known ? 'updated' : 'created';

  const interestIds = await interestIdsForSlugs(event.interestSlugs);

  if (known) {
    await pool.query(
      `UPDATE activities
          SET title = ?, description = ?, location = ?, starts_at = ?, banner_path = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        event.title,
        event.description,
        event.location,
        event.starts_at,
        event.banner_path,
        known.activity_id,
      ],
    );
    await setInterests(known.activity_id, interestIds);
    await pool.query(
      `UPDATE imported_events
          SET content_hash = ?, source_url = ?, last_seen_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [event.contentHash, event.sourceUrl, known.id],
    );
    return 'updated';
  }

  const [inserted] = await pool.query(
    `INSERT INTO activities
       (user_id, title, description, location, starts_at, banner_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      hostId,
      event.title,
      event.description,
      event.location,
      event.starts_at,
      event.banner_path,
    ],
  );
  await setInterests(inserted.insertId, interestIds);
  await pool.query(
    `INSERT INTO imported_events
       (source, external_id, activity_id, content_hash, source_url, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
    [event.source, event.externalId, inserted.insertId, event.contentHash, event.sourceUrl],
  );
  return 'created';
}

/**
 * Raeumt Events auf, die aus der Quelle verschwunden sind (abgesagt).
 *
 * Nur was in DIESEM Lauf nicht gesehen wurde UND noch in der Zukunft liegt:
 * Vergangene Events aus der Quelle zu entfernen ist normal und darf die
 * Aktivitaet nicht loeschen – Leute haben teilgenommen, das steht in ihrem
 * Verlauf (activity_history).
 */
export async function removeVanished(sourceSlug, seenIds, { dryRun = false } = {}) {
  const [rows] = await pool.query(
    `SELECT ie.id, ie.activity_id, ie.external_id
       FROM imported_events ie
       JOIN activities a ON a.id = ie.activity_id
      WHERE ie.source = ? AND a.starts_at > UTC_TIMESTAMP()`,
    [sourceSlug],
  );

  const gone = rows.filter((row) => !seenIds.has(String(row.external_id)));
  if (dryRun || gone.length === 0) return gone.length;

  await pool.query('DELETE FROM activities WHERE id IN (?)', [gone.map((row) => row.activity_id)]);
  // Auch den Merkzettel-Eintrag loeschen, nicht nur die Aktivitaet.
  //
  // Sonst bleibt durch ON DELETE SET NULL eine Zeile mit activity_id NULL
  // zurueck, und die bedeutet in upsertEvent "der Admin wollte das nicht" –
  // eine abgesagte und spaeter doch wieder angesetzte Veranstaltung kaeme dann
  // nie zurueck in die App.
  await pool.query('DELETE FROM imported_events WHERE id IN (?)', [gone.map((row) => row.id)]);
  return gone.length;
}
