/**
 * Ein Konto endgueltig loeschen – samt Daten UND Dateien.
 *
 * Genutzt von zwei Stellen: dem Admin-Panel (DELETE /api/admin/users/:id) und
 * der Selbst-Loeschung (DELETE /api/me in Laravel, which calls the internal route
 * DELETE /internal/accounts/:id in routes/internal.js). Frueher loeschte der
 * Admin-Weg nur die DB-Zeile; die Bilder blieben als Waisen unter storage/
 * liegen – oeffentlich abrufbar fuer jeden, der die Adresse noch kannte. Fuer
 * eine Loeschung, die jemand nach Datenschutzrecht verlangt, ist das zu wenig.
 *
 * ## Was die Datenbank selbst erledigt
 *
 * Fast alles: Jede Tabelle, die an `users` haengt, hat ON DELETE CASCADE bzw.
 * SET NULL (siehe schema.sql). Events, Beitritte, Beitraege, Storys, Chats,
 * Freundschaften, Punkte, Zwei-Faktor-Vorgaenge – das geht mit der einen Zeile.
 * SET NULL steht ABSICHTLICH an drei Stellen, die das Konto ueberdauern sollen:
 * Meldungen (content_reports), KI-Pruefberichte (moderation_reports) und die
 * Admin-Spalten an fremden Zeilen (wer hat entschieden). Das sind Protokolle
 * ueber Vorgaenge, keine Inhalte der Person.
 *
 * ## Was von Hand dazukommt
 *
 *   - `personal_access_tokens` (polymorph, ohne Fremdschluessel),
 *   - `password_reset_tokens` (haengt an der E-Mail, nicht an der ID),
 *   - `sessions` von Laravel (ohne Fremdschluessel; die Tabelle gibt es nur,
 *     wo Laravel mitlaeuft),
 *   - the account's own events, deleted before the account row (MySQL 8.4
 *     foreign-key check, see deleteUserAccount below),
 *   - die Dateien.
 *
 * ## Event-Banner
 *
 * Beim Loeschen EINES Events bleibt dessen Banner sieben Tage stehen, weil der
 * Verlauf der Teilnehmer:innen es noch zeigt (siehe pruneHistory in
 * routes/activities.js). Beim Loeschen eines KONTOS nicht: Wer sein Konto
 * loescht, verlangt, dass seine Bilder verschwinden – jetzt, nicht in einer
 * Woche. Der Verlauf der anderen behaelt Titel, Ort und Datum (das ist ihre
 * Erinnerung, dass sie dort waren) und verliert nur das Bild.
 */
import { pool } from './db.js';
import { removeStored } from './storage.js';

/**
 * Alle Stellen, an denen ein Pfad unter storage/ stehen kann.
 *
 * Eine Datei wird nur geloescht, wenn danach KEINE dieser Spalten mehr auf sie
 * zeigt. Beispiel: Das Beweisbild einer KI-Sperre steht zugleich im Pruefbericht
 * (moderation_reports, bleibt) und im Sperr-Beweis (ban_evidence, geht mit dem
 * Konto) – dort muss es bleiben, sonst zeigt das Admin-Panel ein leeres Bild.
 * Neue Upload-Spalten gehoeren hier dazu.
 */
const FILE_REFERENCES = [
  ['users', 'avatar'],
  ['users', 'banner'],
  ['posts', 'image_path'],
  ['stories', 'image_path'],
  ['activities', 'banner_path'],
  ['activity_history', 'banner_path'],
  ['ban_evidence', 'image_path'],
  ['moderation_reports', 'image_path'],
];

/** Ein eigener Upload? Fremde URLs (Google-Avatare, importierte Banner) nicht. */
function isStoredFile(value) {
  return typeof value === 'string' && value !== '' && !/^https?:\/\//i.test(value);
}

async function stillReferenced(filePath) {
  for (const [table, column] of FILE_REFERENCES) {
    const [rows] = await pool.query(`SELECT 1 AS ok FROM ${table} WHERE ${column} = ? LIMIT 1`, [filePath]);
    if (rows.length > 0) return true;
  }
  return false;
}

/**
 * Datei entfernen – best effort.
 *
 * Der Pfad kommt zwar aus der eigenen DB, trotzdem wird geprueft, dass er
 * innerhalb seines Ordners bleibt: Ein `../` in einer Zeile waere sonst ein
 * Loeschbefehl fuer beliebige Dateien des Servers. storage.js resolves the value against its
 * root: the public tree for avatars, banners and post images, the private one for story images
 * and evidence (F-11), so those go with the account too.
 */
async function removeStoredFile(filePath) {
  await removeStored(filePath);
}

/**
 * Loescht das Konto.
 *
 * `refuseLastAdmin`: Ist das Konto der letzte Admin, bleibt es stehen – sonst
 * haette die Anwendung niemanden mehr, der Sperren aufhebt oder Anfragen
 * freischaltet, und ein neuer Admin liesse sich nur noch in der DB von Hand
 * setzen. Gezaehlt wird INNERHALB der Transaktion mit Sperre auf den
 * Admin-Zeilen: Zwei Admins, die sich gleichzeitig loeschen, sehen sonst
 * beide „es gibt ja noch einen" – und danach gibt es keinen.
 *
 * Ergebnis: 'deleted' | 'not_found' | 'last_admin'.
 */
export async function deleteUserAccount(userId, { refuseLastAdmin = false } = {}) {
  const conn = await pool.getConnection();
  let files = [];

  try {
    await conn.beginTransaction();

    const [[user]] = await conn.query('SELECT id, email, avatar, banner, is_admin FROM users WHERE id = ?', [
      userId,
    ]);
    if (!user) {
      await conn.rollback();
      return 'not_found';
    }

    if (refuseLastAdmin && user.is_admin) {
      const [admins] = await conn.query('SELECT id FROM users WHERE is_admin = 1 FOR UPDATE');
      if (!admins.some((row) => Number(row.id) !== Number(user.id))) {
        await conn.rollback();
        return 'last_admin';
      }
    }

    const [posts] = await conn.query(
      'SELECT image_path AS p FROM posts WHERE user_id = ? AND image_path IS NOT NULL',
      [user.id],
    );
    const [stories] = await conn.query('SELECT image_path AS p FROM stories WHERE user_id = ?', [user.id]);
    const [evidence] = await conn.query(
      'SELECT image_path AS p FROM ban_evidence WHERE user_id = ? AND image_path IS NOT NULL',
      [user.id],
    );
    const [activities] = await conn.query('SELECT id, banner_path AS p FROM activities WHERE user_id = ?', [
      user.id,
    ]);
    // Auch Banner laengst geloeschter eigener Events: Sie stehen noch im
    // Verlauf anderer, solange deren 7-Tage-Frist laeuft.
    const [hostHistory] = await conn.query(
      `SELECT DISTINCT banner_path AS p FROM activity_history
        WHERE user_id = ? AND role = 'host' AND banner_path IS NOT NULL`,
      [user.id],
    );

    const eventBanners = [...activities, ...hostHistory].map((row) => row.p).filter(isStoredFile);

    // Verlauf der Teilnehmer:innen: Frist starten wie beim Loeschen eines
    // einzelnen Events – der Fremdschluessel setzt activity_id nur auf NULL.
    if (activities.length > 0) {
      await conn.query(
        `UPDATE activity_history SET removed_at = NOW(), updated_at = NOW()
          WHERE activity_id IN (?) AND removed_at IS NULL`,
        [activities.map((row) => row.id)],
      );
    }
    if (eventBanners.length > 0) {
      await conn.query('UPDATE activity_history SET banner_path = NULL, updated_at = NOW() WHERE banner_path IN (?)', [
        eventBanners,
      ]);
    }

    // Delete the account's own events before the account row. With a single DELETE FROM users,
    // MySQL 8.4 cascades to activities and to activity_history / reward_points at once; the
    // events' ON DELETE SET NULL then updates the host's own rows, and InnoDB re-checks their
    // user_id foreign key against the user row that is already being deleted
    // (ER_NO_REFERENCED_ROW_2). Deleted first, the SET NULL runs while the user row still exists.
    // The participants' history was updated above, while activity_id was still set.
    await conn.query('DELETE FROM activities WHERE user_id = ?', [user.id]);

    await conn.query('DELETE FROM personal_access_tokens WHERE tokenable_id = ?', [user.id]);
    await conn.query('DELETE FROM password_reset_tokens WHERE email = ?', [user.email]);
    try {
      await conn.query('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    } catch (err) {
      // Ohne Laravel (z. B. im Docker-Abbild aus deploy/) gibt es die Tabelle nicht.
      if (err?.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    await conn.query('DELETE FROM users WHERE id = ?', [user.id]);

    await conn.commit();

    files = [
      user.avatar,
      user.banner,
      ...posts.map((row) => row.p),
      ...stories.map((row) => row.p),
      ...evidence.map((row) => row.p),
      ...eventBanners,
    ].filter(isStoredFile);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Dateien erst NACH dem Commit: Kippt die Transaktion, zeigt das Konto
  // weiter auf Bilder, die es noch gibt. Umgekehrt (Datei weg, Konto noch da)
  // waere es ein Konto mit kaputten Bildern.
  for (const file of new Set(files)) {
    if (!(await stillReferenced(file))) await removeStoredFile(file);
  }

  return 'deleted';
}
