import 'dotenv/config';
import mysql from 'mysql2/promise';

/**
 * Verbindungs-Pool zur MySQL-Datenbank (dieselbe DB wie das alte Laravel-Backend).
 *
 * `dateStrings: true` liefert Datums-Spalten als roher String ('YYYY-MM-DD HH:MM:SS')
 * statt als JS-Date. So gibt es keine Zeitzonen-Verschiebung: Laravel speichert in UTC,
 * wir haengen beim Ausliefern einfach 'Z' an.
 */
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'goenntertainment',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

/** Kleiner Helfer: erste Zeile eines SELECTs oder null. */
export async function first(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] ?? null;
}

/** Wandelt eine DB-DateTime (UTC-String) in einen ISO-8601-String um. */
export function toIso(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return `${String(value).replace(' ', 'T')}Z`;
}

/** Gibt es die Spalte schon? (MySQL 8 kennt kein ADD COLUMN IF NOT EXISTS.) */
async function hasColumn(table, column) {
  const row = await first(
    `SELECT 1 AS ok FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column],
  );
  return Boolean(row);
}

/**
 * Legt beim Serverstart Tabellen an, die erst spaeter dazugekommen sind und in
 * einer bestehenden DB evtl. noch fehlen (schema.sql wird nicht automatisch
 * ausgefuehrt). Idempotent dank CREATE TABLE IF NOT EXISTS.
 */
export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_history (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NOT NULL,
      activity_id BIGINT UNSIGNED NULL,
      role        ENUM('host','participant') NOT NULL,
      title       VARCHAR(255)    NOT NULL,
      location    VARCHAR(255)    NOT NULL,
      starts_at   DATETIME        NULL,
      banner_path VARCHAR(255)    NULL,
      removed_at  TIMESTAMP       NULL,
      created_at  TIMESTAMP       NULL,
      updated_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY activity_history_user_activity_uq (user_id, activity_id),
      KEY activity_history_user_id_idx (user_id),
      KEY activity_history_removed_at_idx (removed_at),
      CONSTRAINT activity_history_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT activity_history_activity_id_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Aufrufe je Aktivitaet (Ticket #5): eine Zeile pro Person und Event,
  // damit die Zahl "gesehen von" statt "Klicks" bedeutet.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_views (
      activity_id BIGINT UNSIGNED NOT NULL,
      user_id     BIGINT UNSIGNED NOT NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (activity_id, user_id),
      KEY activity_views_user_id_idx (user_id),
      CONSTRAINT activity_views_activity_id_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      CONSTRAINT activity_views_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Beweismittel je Sperr-Aktion, siehe schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ban_evidence (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id      BIGINT UNSIGNED NOT NULL,
      admin_id     BIGINT UNSIGNED NULL,
      source       VARCHAR(10)     NOT NULL DEFAULT 'admin',
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Berichte der KI-Verifizierung (Jugendschutz), siehe schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_reports (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NULL,
      context     VARCHAR(20)     NOT NULL,
      verdict     VARCHAR(20)     NOT NULL,
      severity    TINYINT UNSIGNED NOT NULL DEFAULT 0,
      categories  VARCHAR(255)    NULL,
      fields      VARCHAR(255)    NULL,
      reason      VARCHAR(500)    NULL,
      action      VARCHAR(20)     NOT NULL,
      title       VARCHAR(255)    NULL,
      body        TEXT            NULL,
      interests   VARCHAR(500)    NULL,
      image_path  VARCHAR(255)    NULL,
      model       VARCHAR(60)     NULL,
      latency_ms  INT UNSIGNED    NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      KEY moderation_reports_user_id_idx (user_id),
      KEY moderation_reports_created_at_idx (created_at),
      CONSTRAINT moderation_reports_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Aktive Tage je Nutzer:in – Grundlage der Serie ("Streak"), siehe schema.sql
  // und src/streak.js. Eine Zeile pro Person und Kalendertag.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_active_days (
      user_id BIGINT UNSIGNED NOT NULL,
      day     DATE            NOT NULL,
      PRIMARY KEY (user_id, day),
      KEY user_active_days_day_idx (day),
      CONSTRAINT user_active_days_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Beitraege der oeffentlichen Profilseite, siehe schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      body       VARCHAR(1000)   NOT NULL,
      image_path VARCHAR(255)    NULL,
      created_at TIMESTAMP       NULL,
      updated_at TIMESTAMP       NULL,
      PRIMARY KEY (id),
      KEY posts_user_created_idx (user_id, created_at),
      CONSTRAINT posts_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Social-Links der Profilseite, siehe schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_links (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      platform   VARCHAR(30)     NOT NULL,
      url        VARCHAR(255)    NOT NULL,
      created_at TIMESTAMP       NULL,
      updated_at TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY user_links_user_platform_uq (user_id, platform),
      CONSTRAINT user_links_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Punkte-Buchungen und eingeloeste Coupons ("Praemien"), siehe schema.sql
  // und src/rewards.js.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reward_points (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NOT NULL,
      points      INT             NOT NULL,
      reason      VARCHAR(30)     NOT NULL,
      activity_id BIGINT UNSIGNED NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY reward_points_reason_ref_uq (user_id, reason, activity_id),
      KEY reward_points_user_id_idx (user_id),
      CONSTRAINT reward_points_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT reward_points_activity_id_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reward_redemptions (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NOT NULL,
      coupon_slug VARCHAR(40)     NOT NULL,
      code        VARCHAR(40)     NOT NULL,
      points      INT             NOT NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY reward_redemptions_code_uq (code),
      KEY reward_redemptions_user_id_idx (user_id),
      CONSTRAINT reward_redemptions_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Storys (24 h) und wer sie gesehen hat, siehe schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stories (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      caption    VARCHAR(200)    NULL,
      image_path VARCHAR(255)    NOT NULL,
      created_at TIMESTAMP       NULL,
      expires_at DATETIME        NOT NULL,
      PRIMARY KEY (id),
      KEY stories_expires_at_idx (expires_at),
      KEY stories_user_id_idx (user_id),
      CONSTRAINT stories_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS story_views (
      story_id   BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP       NULL,
      PRIMARY KEY (story_id, user_id),
      KEY story_views_user_id_idx (user_id),
      CONSTRAINT story_views_story_id_fk
        FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE,
      CONSTRAINT story_views_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Freundschaften und Gruppen, siehe schema.sql und src/routes/friends.js.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      requester_id BIGINT UNSIGNED NOT NULL,
      addressee_id BIGINT UNSIGNED NOT NULL,
      status       ENUM('pending','accepted') NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMP       NULL,
      updated_at   TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY friendships_pair_uq (requester_id, addressee_id),
      KEY friendships_addressee_idx (addressee_id, status),
      CONSTRAINT friendships_requester_fk
        FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT friendships_addressee_fk
        FOREIGN KEY (addressee_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_groups (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      owner_id    BIGINT UNSIGNED NOT NULL,
      name        VARCHAR(60)     NOT NULL,
      description VARCHAR(200)    NULL,
      created_at  TIMESTAMP       NULL,
      updated_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      KEY friend_groups_owner_idx (owner_id),
      CONSTRAINT friend_groups_owner_fk
        FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id   BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP       NULL,
      PRIMARY KEY (group_id, user_id),
      KEY group_members_user_id_idx (user_id),
      CONSTRAINT group_members_group_fk
        FOREIGN KEY (group_id) REFERENCES friend_groups (id) ON DELETE CASCADE,
      CONSTRAINT group_members_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Anfragen auf eine hoehere Kontostufe – eine Zeile pro Konto, siehe
  // schema.sql fuer die Begruendung.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_upgrade_requests (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id        BIGINT UNSIGNED NOT NULL,
      requested_type VARCHAR(20)     NOT NULL,
      status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      message        VARCHAR(500)    NULL,
      decided_by     BIGINT UNSIGNED NULL,
      decided_at     DATETIME        NULL,
      decision_note  VARCHAR(255)    NULL,
      created_at     TIMESTAMP       NULL,
      updated_at     TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY account_upgrade_requests_user_uq (user_id),
      KEY account_upgrade_requests_status_idx (status, created_at),
      CONSTRAINT account_upgrade_requests_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT account_upgrade_requests_admin_fk
        FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Chat-Raeume, Nachrichten und Lesestaende, siehe schema.sql und
  // src/messaging.js. Der Raum ist eine eigene Zeile, damit jede Nachricht per
  // Fremdschluessel an Gruppe bzw. Event haengt und beim Loeschen mitgeht.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      kind        VARCHAR(10)     NOT NULL,
      group_id    BIGINT UNSIGNED NULL,
      activity_id BIGINT UNSIGNED NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY chat_rooms_group_uq (group_id),
      UNIQUE KEY chat_rooms_activity_uq (activity_id),
      CONSTRAINT chat_rooms_group_fk
        FOREIGN KEY (group_id) REFERENCES friend_groups (id) ON DELETE CASCADE,
      CONSTRAINT chat_rooms_activity_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_id            BIGINT UNSIGNED NOT NULL,
      user_id            BIGINT UNSIGNED NOT NULL,
      body               VARCHAR(1000)   NOT NULL DEFAULT '',
      shared_activity_id BIGINT UNSIGNED NULL,
      shared_title       VARCHAR(255)    NULL,
      created_at         TIMESTAMP       NULL,
      PRIMARY KEY (id),
      KEY chat_messages_room_idx (room_id, id),
      KEY chat_messages_user_id_idx (user_id),
      CONSTRAINT chat_messages_room_fk
        FOREIGN KEY (room_id) REFERENCES chat_rooms (id) ON DELETE CASCADE,
      CONSTRAINT chat_messages_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT chat_messages_shared_activity_fk
        FOREIGN KEY (shared_activity_id) REFERENCES activities (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_reads (
      room_id      BIGINT UNSIGNED NOT NULL,
      user_id      BIGINT UNSIGNED NOT NULL,
      last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_at   TIMESTAMP       NULL,
      PRIMARY KEY (room_id, user_id),
      KEY chat_reads_user_id_idx (user_id),
      CONSTRAINT chat_reads_room_fk
        FOREIGN KEY (room_id) REFERENCES chat_rooms (id) ON DELETE CASCADE,
      CONSTRAINT chat_reads_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Blockierte Konten, siehe schema.sql und src/routes/friends.js.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id BIGINT UNSIGNED NOT NULL,
      blocked_id BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP       NULL,
      PRIMARY KEY (blocker_id, blocked_id),
      KEY user_blocks_blocked_idx (blocked_id),
      CONSTRAINT user_blocks_blocker_fk
        FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT user_blocks_blocked_fk
        FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Meldungen von Inhalten und Konten, siehe schema.sql und src/reports.js.
  // `target_id` bewusst ohne Fremdschluessel: Die Meldung muss das Loeschen
  // ihres Gegenstands ueberdauern.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_reports (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      reporter_id BIGINT UNSIGNED NULL,
      target_type VARCHAR(20)     NOT NULL,
      target_id   BIGINT UNSIGNED NOT NULL,
      reason      VARCHAR(30)     NOT NULL,
      note        VARCHAR(500)    NULL,
      status      ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
      handled_by  BIGINT UNSIGNED NULL,
      handled_at  DATETIME        NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY content_reports_once_uq (reporter_id, target_type, target_id),
      KEY content_reports_status_idx (status, created_at),
      KEY content_reports_target_idx (target_type, target_id),
      CONSTRAINT content_reports_reporter_fk
        FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT content_reports_admin_fk
        FOREIGN KEY (handled_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Merkliste, siehe schema.sql. Getrennt von der Teilnahme: Merken ist keine Zusage.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_saves (
      activity_id BIGINT UNSIGNED NOT NULL,
      user_id     BIGINT UNSIGNED NOT NULL,
      created_at  TIMESTAMP       NULL,
      PRIMARY KEY (activity_id, user_id),
      KEY activity_saves_user_idx (user_id, created_at),
      CONSTRAINT activity_saves_activity_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      CONSTRAINT activity_saves_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Nachtraeglich: welchen Stand der Nutzungsbedingungen ein Konto bestaetigt
  // hat. Bestandskonten bleiben NULL – die App fragt dann beim naechsten Start
  // nach (siehe src/domain/legal.ts).
  if (!(await hasColumn('users', 'terms_version'))) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN terms_version VARCHAR(20) NULL AFTER ban_reason',
    );
  }
  if (!(await hasColumn('users', 'terms_accepted_at'))) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME NULL AFTER terms_version',
    );
  }

  // Nachtraeglich: unterscheidet Sperren von Hand ('admin') und automatische
  // Sperren der KI-Moderation ('ai'). Bestehende Eintraege bleiben 'admin'.
  if (!(await hasColumn('ban_evidence', 'source'))) {
    await pool.query(
      `ALTER TABLE ban_evidence ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'admin' AFTER admin_id`,
    );
  }

  // Nachtraeglich: bis wann ein Event hervorgehoben ist. Business-Stufen setzen
  // das (siehe routes/business.js), die Empfehlungen der App sortieren danach.
  if (!(await hasColumn('activities', 'boosted_until'))) {
    await pool.query(
      'ALTER TABLE activities ADD COLUMN boosted_until DATETIME NULL AFTER max_participants',
    );
  }

  // Nachtraeglich: Bild hinter der Profil-Karte ("Banner"). Die App zeigt es
  // weichgezeichnet als Hintergrund der Karte, siehe src/app/profile/[username].tsx.
  if (!(await hasColumn('users', 'banner'))) {
    await pool.query('ALTER TABLE users ADD COLUMN banner VARCHAR(255) NULL AFTER avatar');
  }

  // Alte Kontotypen auf die neue Leiter heben: 'personal' war der Wert, den die
  // App vor den vier Stufen kannte – das ist heute 'standard'. Idempotent: nach
  // dem ersten Lauf trifft das UPDATE nichts mehr. NULL bleibt bewusst NULL,
  // sonst wuerden Google-Konten ohne Kontotyp ploetzlich als vollstaendig
  // gelten (profileComplete prueft auf NULL).
  await pool.query(`UPDATE users SET account_type = 'standard' WHERE account_type = 'personal'`);
}
