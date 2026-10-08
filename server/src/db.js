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

  // The counter of the global AI moderation budget per UTC day (F-07), see schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_call_counts (
      day   DATE         NOT NULL,
      calls INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (day)
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
      invite_code VARCHAR(12)     NULL,
      PRIMARY KEY (id),
      UNIQUE KEY friend_groups_invite_code_unique (invite_code),
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

  // Marketplace partners and their offers (Laravel migrations in api/database/migrations; the
  // definitions are those of server/schema.sql). Before the chat tables: chat_messages.shared_offer_id
  // refers to offers. The other marketplace tables are at the end of this function.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partners (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug                  VARCHAR(80) NOT NULL,
      name                  VARCHAR(120) NOT NULL,
      tagline               VARCHAR(160) NULL,
      description           TEXT NULL,
      interest_id           BIGINT UNSIGNED NULL,
      address               VARCHAR(200) NULL,
      city                  VARCHAR(80) NULL,
      lat                   DECIMAL(10,7) NULL,
      lng                   DECIMAL(10,7) NULL,
      logo_path             VARCHAR(255) NULL,
      cover_path            VARCHAR(255) NULL,
      phone                 VARCHAR(40) NULL,
      website               VARCHAR(200) NULL,
      instagram             VARCHAR(80) NULL,
      opening_hours         VARCHAR(500) NULL,
      checkin_token         VARCHAR(40) NOT NULL,
      max_discount_percent  TINYINT UNSIGNED NULL,
      is_active             TINYINT(1) NOT NULL DEFAULT 1,
      is_featured           TINYINT(1) NOT NULL DEFAULT 0,
      created_at            TIMESTAMP NULL,
      updated_at            TIMESTAMP NULL,
      wheelchair_accessible TINYINT(1) NULL,
      kid_friendly          TINYINT(1) NULL,
      quiet_times           VARCHAR(160) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY partners_slug_unique (slug),
      UNIQUE KEY partners_checkin_token_unique (checkin_token),
      KEY partners_interest_id_foreign (interest_id),
      CONSTRAINT partners_interest_id_foreign
        FOREIGN KEY (interest_id) REFERENCES interests (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS offers (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      partner_id           BIGINT UNSIGNED NOT NULL,
      kind                 VARCHAR(20) NOT NULL DEFAULT 'activity',
      title                VARCHAR(120) NOT NULL,
      subtitle             VARCHAR(160) NULL,
      description          TEXT NULL,
      interest_id          BIGINT UNSIGNED NULL,
      image_path           VARCHAR(255) NULL,
      price_cents          INT UNSIGNED NULL,
      price_credits        INT UNSIGNED NULL,
      max_discount_percent TINYINT UNSIGNED NULL,
      min_people           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      max_people           SMALLINT UNSIGNED NULL,
      min_age              TINYINT UNSIGNED NULL,
      max_age              TINYINT UNSIGNED NULL,
      duration_minutes     SMALLINT UNSIGNED NULL,
      indoor               TINYINT(1) NULL,
      valid_days           SMALLINT UNSIGNED NOT NULL DEFAULT 90,
      is_active            TINYINT(1) NOT NULL DEFAULT 1,
      is_featured          TINYINT(1) NOT NULL DEFAULT 0,
      sort                 SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at           TIMESTAMP NULL,
      updated_at           TIMESTAMP NULL,
      daily_capacity       SMALLINT UNSIGNED NULL,
      platinum_reserved    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY offers_partner_id_foreign (partner_id),
      KEY offers_interest_id_foreign (interest_id),
      KEY offers_is_active_kind_index (is_active, kind),
      CONSTRAINT offers_interest_id_foreign
        FOREIGN KEY (interest_id) REFERENCES interests (id) ON DELETE SET NULL,
      CONSTRAINT offers_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Anfragen auf eine hoehere Kontostufe – eine Zeile pro Konto, siehe
  // schema.sql fuer die Begruendung.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_upgrade_requests (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id        BIGINT UNSIGNED NOT NULL,
      requested_type VARCHAR(20)     NOT NULL,
      billing_period VARCHAR(10)     NOT NULL DEFAULT 'monthly',
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
      shared_offer_id    BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      KEY chat_messages_room_idx (room_id, id),
      KEY chat_messages_user_id_idx (user_id),
      KEY chat_messages_shared_offer_id_foreign (shared_offer_id),
      CONSTRAINT chat_messages_room_fk
        FOREIGN KEY (room_id) REFERENCES chat_rooms (id) ON DELETE CASCADE,
      CONSTRAINT chat_messages_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT chat_messages_shared_activity_fk
        FOREIGN KEY (shared_activity_id) REFERENCES activities (id) ON DELETE SET NULL,
      CONSTRAINT chat_messages_shared_offer_id_foreign
        FOREIGN KEY (shared_offer_id) REFERENCES offers (id) ON DELETE SET NULL
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
      snapshot    JSON            NULL,
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

  // Gefaellt-mir an einem Event, siehe schema.sql. Gleicher Aufbau wie
  // `post_likes`: eine Zeile pro Person und Event.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_likes (
      activity_id BIGINT UNSIGNED NOT NULL,
      user_id     BIGINT UNSIGNED NOT NULL,
      created_at  DATETIME        NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (activity_id, user_id),
      KEY activity_likes_user_idx (user_id),
      CONSTRAINT activity_likes_activity_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      CONSTRAINT activity_likes_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Kommentare an einem Event, siehe schema.sql. Gleicher Aufbau wie `post_comments`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_comments (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      activity_id BIGINT UNSIGNED NOT NULL,
      user_id     BIGINT UNSIGNED NOT NULL,
      body        VARCHAR(500)    NOT NULL,
      created_at  DATETIME        NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY activity_comments_activity_idx (activity_id, id),
      KEY activity_comments_user_idx (user_id),
      CONSTRAINT activity_comments_activity_fk
        FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      CONSTRAINT activity_comments_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Folgen: EINSEITIG und damit etwas anderes als eine Freundschaft.
  //
  // Freundschaft ist ein Vertrag zu zweit (anfragen, annehmen) und schaltet
  // Gruppen und Chats frei. Folgen ist eine Abo-Entscheidung, die nur die
  // folgende Person trifft: Sie will sehen, was jemand veroeffentlicht. Deshalb
  // eine Zeile je Richtung und keine Anfrage – und deshalb eine eigene Tabelle
  // statt eines Status in `friendships`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS follows (
      follower_id  BIGINT UNSIGNED NOT NULL,
      following_id BIGINT UNSIGNED NOT NULL,
      created_at   TIMESTAMP       NULL,
      PRIMARY KEY (follower_id, following_id),
      KEY follows_following_idx (following_id),
      CONSTRAINT follows_follower_fk
        FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT follows_following_fk
        FOREIGN KEY (following_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Gefaellt-mir an einem Beitrag. Eine Zeile pro Person und Beitrag – damit ist
  // die Zahl „wie vielen gefaellt das" und nicht „wie oft wurde geklickt".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id    BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP       NULL,
      PRIMARY KEY (post_id, user_id),
      KEY post_likes_user_idx (user_id),
      CONSTRAINT post_likes_post_fk
        FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
      CONSTRAINT post_likes_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Kommentare an einem Beitrag.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      post_id    BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      body       VARCHAR(500)    NOT NULL,
      created_at TIMESTAMP       NULL,
      PRIMARY KEY (id),
      KEY post_comments_post_idx (post_id, id),
      KEY post_comments_user_idx (user_id),
      CONSTRAINT post_comments_post_fk
        FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
      CONSTRAINT post_comments_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Benachrichtigungen.
  //
  // `ref_id` hat bewusst KEINEN Fremdschluessel: Die Nachricht „X hat eine Story
  // veroeffentlicht" muss die Story ueberleben – sonst verschwaende der Verlauf
  // nach 24 Stunden rueckwirkend. Deshalb tragen `title`/`body` den Text schon
  // fertig; beim Antippen prueft die App, ob es das Ziel noch gibt.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      actor_id   BIGINT UNSIGNED NULL,
      type       VARCHAR(20)     NOT NULL,
      ref_id     BIGINT UNSIGNED NULL,
      title      VARCHAR(160)    NOT NULL,
      body       VARCHAR(300)    NULL,
      read_at    DATETIME        NULL,
      created_at TIMESTAMP       NULL,
      PRIMARY KEY (id),
      KEY notifications_user_idx (user_id, id),
      KEY notifications_unread_idx (user_id, read_at),
      CONSTRAINT notifications_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT notifications_actor_fk
        FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE CASCADE
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

  // The minimum-age confirmation at sign-up (F-14), right after the terms columns as in
  // schema.sql. Accounts from before stay NULL.
  if (!(await hasColumn('users', 'min_age_confirmed'))) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN min_age_confirmed TINYINT UNSIGNED NULL AFTER terms_accepted_at',
    );
  }
  if (!(await hasColumn('users', 'min_age_confirmed_at'))) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN min_age_confirmed_at DATETIME NULL AFTER min_age_confirmed',
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
  // Must run before is_permanent, which is added AFTER boosted_until.
  if (!(await hasColumn('activities', 'boosted_until'))) {
    await pool.query(
      'ALTER TABLE activities ADD COLUMN boosted_until DATETIME NULL AFTER max_participants',
    );
  }

  /**
   * Nachtraeglich: Dauerangebot ohne festen Termin.
   *
   * Bowling, Trampolinhalle, Freibad – Orte, an die man einfach hingehen kann.
   * Sie sind keine Termine, aber sie gehoeren in dieselbe Liste, weil sie
   * dieselbe Frage beantworten: „was mache ich?".
   *
   * ## Warum ein Kennzeichen und nicht `starts_at NULL`
   *
   * `starts_at` ist NOT NULL, und ein Dutzend Abfragen sortiert und filtert
   * darueber (Verlauf, Chat-Freigaben, Empfehlungen). Die Spalte nullable zu
   * machen hiesse, jede davon anzufassen – fuer eine Handvoll Zeilen, die
   * ohnehin kein Datum HABEN.
   *
   * Stattdessen: `starts_at` traegt bei diesen Zeilen den Anlege-Zeitpunkt, und
   * er ist BEDEUTUNGSLOS. Die App zeigt ihn nicht und rechnet nicht mit ihm –
   * sie liest `is_permanent` und behandelt den Eintrag als „immer moeglich"
   * (siehe src/domain/activity-filter.ts und src/components/activity-card.tsx).
   */
  if (!(await hasColumn('activities', 'is_permanent'))) {
    await pool.query(
      'ALTER TABLE activities ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER boosted_until',
    );
  }

  /**
   * Nachtraeglich: die Rangfolge der Kategorien EINES Events.
   *
   * Ein Event darf fuenf Kategorien tragen, und die App unterteilt ihre Listen
   * nach der FUEHRENDEN (siehe src/domain/interest-group.ts). Ohne diese Spalte
   * gab es keine Rangfolge: Die Abfrage sortierte `ORDER BY i.name`, also
   * alphabetisch – ein Salsa-Abend mit [Tanzen, Party & Club] landete unter
   * "Party & Club", weil P vor T kommt. Die Absicht des Importers
   * (INTEREST_RULES, spezifisch vor allgemein) war damit weg.
   *
   * 0 = die fuehrende Kategorie. Beim Erstellen in der App ist es die Reihenfolge,
   * in der ausgewaehlt wurde.
   */
  if (!(await hasColumn('activity_interest', 'rank'))) {
    await pool.query(
      'ALTER TABLE activity_interest ADD COLUMN `rank` TINYINT UNSIGNED NOT NULL DEFAULT 0',
    );
  }

  // Nachtraeglich: Bild hinter der Profil-Karte ("Banner"). Die App zeigt es
  // weichgezeichnet als Hintergrund der Karte, siehe src/app/profile/[username].tsx.
  if (!(await hasColumn('users', 'banner'))) {
    await pool.query('ALTER TABLE users ADD COLUMN banner VARCHAR(255) NULL AFTER avatar');
  }

  // Nachtraeglich: Monats- oder Jahresabo an der Anfrage (siehe
  // routes/upgrades.js). Bestandsanfragen wurden ohne Jahresabo gestellt, es gab
  // damals keines – deshalb ist 'monthly' hier nicht bloss ein Vorgabewert,
  // sondern die richtige Antwort fuer jede vorhandene Zeile.
  if (!(await hasColumn('account_upgrade_requests', 'billing_period'))) {
    await pool.query(
      `ALTER TABLE account_upgrade_requests
         ADD COLUMN billing_period VARCHAR(10) NOT NULL DEFAULT 'monthly' AFTER requested_type`,
    );
  }

  // Alte Kontotypen auf die neue Leiter heben: 'personal' war der Wert, den die
  // App vor den vier Stufen kannte – das ist heute 'standard'. Idempotent: nach
  // dem ersten Lauf trifft das UPDATE nichts mehr. NULL bleibt bewusst NULL,
  // sonst wuerden Google-Konten ohne Kontotyp ploetzlich als vollstaendig
  // gelten (User::profileComplete in Laravel prueft auf NULL).
  await pool.query(`UPDATE users SET account_type = 'standard' WHERE account_type = 'personal'`);

  // Laufende Abos aus dem App Store / Play Store (gemeldet von RevenueCat).
  // Aufbau und Begruendung stehen bei derselben Tabelle in schema.sql.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NOT NULL,
      entitlement VARCHAR(20)     NOT NULL,
      provider    VARCHAR(20)     NOT NULL,
      product_id  VARCHAR(191)    NULL,
      status      ENUM('active','grace','expired') NOT NULL DEFAULT 'active',
      expires_at  DATETIME        NULL,
      event_at    DATETIME        NULL,
      created_at  TIMESTAMP       NULL,
      updated_at  TIMESTAMP       NULL,
      PRIMARY KEY (id),
      UNIQUE KEY subscriptions_user_entitlement_uq (user_id, entitlement),
      KEY subscriptions_active_idx (user_id, status, expires_at),
      CONSTRAINT subscriptions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Nachtraeglich: die von Hand vergebene Stufe, getrennt von der, die gilt.
  //
  // Die UEBERNAHME steht ABSICHTLICH IN DIESEM if-Block und nicht daneben: Sie
  // darf genau einmal laufen, naemlich in dem Moment, in dem die Spalte entsteht.
  // Zu diesem Zeitpunkt gibt es noch keine Abos, also ist jede vorhandene Stufe
  // eine Vergabe von Hand – niemand verliert etwas.
  //
  // Liefe sie bei jedem Serverstart, waere sie ein Geschenk mit Folgen: Nach dem
  // ersten Abo stuende dessen Stufe in `account_type`, die Uebernahme schriebe
  // sie nach `granted_account_type`, und damit waere ein bezahltes Abo dauerhaft
  // vergeben – auch nach der Kuendigung. Das faellt niemandem auf, ausser an den
  // fehlenden Einnahmen.
  if (!(await hasColumn('users', 'granted_account_type'))) {
    await pool.query(
      'ALTER TABLE users ADD COLUMN granted_account_type VARCHAR(255) NULL AFTER account_type',
    );
    await pool.query('UPDATE users SET granted_account_type = account_type');
  }

  /**
   * Nachtraeglich: Zwei-Faktor-Anmeldung, siehe schema.sql.
   *
   * Bedient wird sie von Laravel (api/app/Support/TwoFactor.php) – das Schema
   * liegt trotzdem hier, weil dieses Backend das Schema besitzt. Node itself
   * issues no tokens (sign-in is Laravel's) and only passes `two_factor_method`
   * on in user payloads (serializeUser in auth.js).
   *
   * In einer Schleife und einzeln geprueft, damit eine halb nachgeruestete DB
   * (Abbruch mitten im Start) beim naechsten Start einfach weitermacht. Die
   * Reihenfolge ist die von schema.sql: Laravel liefert die Spalten in
   * Tabellen-Reihenfolge aus (siehe api/app/Http/Resources/UserResource.php).
   */
  const twoFactorColumns = [
    ['two_factor_method', 'VARCHAR(10) NULL', 'min_age_confirmed_at'],
    ['two_factor_secret', 'TEXT NULL', 'two_factor_method'],
    ['two_factor_recovery_codes', 'TEXT NULL', 'two_factor_secret'],
    ['two_factor_confirmed_at', 'DATETIME NULL', 'two_factor_recovery_codes'],
    ['two_factor_last_step', 'BIGINT NULL', 'two_factor_confirmed_at'],
  ];
  for (const [column, type, after] of twoFactorColumns) {
    if (!(await hasColumn('users', column))) {
      await pool.query(`ALTER TABLE users ADD COLUMN ${column} ${type} AFTER ${after}`);
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS two_factor_challenges (
      id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      user_id      BIGINT UNSIGNED  NOT NULL,
      token_hash   CHAR(64)         NOT NULL,
      method       VARCHAR(10)      NULL,
      code_hash    CHAR(64)         NULL,
      purpose      VARCHAR(10)      NOT NULL,
      attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
      expires_at   DATETIME         NOT NULL,
      created_at   TIMESTAMP        NULL,
      last_sent_at DATETIME         NULL,
      PRIMARY KEY (id),
      UNIQUE KEY two_factor_challenges_token_uq (token_hash),
      KEY two_factor_challenges_user_idx (user_id, purpose),
      KEY two_factor_challenges_expires_idx (expires_at),
      CONSTRAINT two_factor_challenges_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Laravel's database cache store (rate-limit counters); see server/schema.sql for why.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cache (
      \`key\`      VARCHAR(255) NOT NULL,
      value      MEDIUMTEXT   NOT NULL,
      expiration BIGINT       NOT NULL,
      PRIMARY KEY (\`key\`),
      KEY cache_expiration_index (expiration)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cache_locks (
      \`key\`      VARCHAR(255) NOT NULL,
      owner      VARCHAR(255) NOT NULL,
      expiration BIGINT       NOT NULL,
      PRIMARY KEY (\`key\`),
      KEY cache_locks_expiration_index (expiration)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // The other marketplace tables (Laravel migrations in api/database/migrations), in the definitions
  // of server/schema.sql: payments, bookings, check-ins and stamps, vouchers, credits and their
  // expiry lots, feature switches, group polls, partner staff and wishes, and the admins' test phase.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id      BIGINT UNSIGNED NULL,
      purpose      VARCHAR(20) NOT NULL,
      amount_cents INT UNSIGNED NOT NULL,
      provider     VARCHAR(20) NOT NULL,
      provider_ref VARCHAR(120) NULL,
      status       VARCHAR(20) NOT NULL,
      description  VARCHAR(200) NOT NULL,
      created_at   TIMESTAMP NULL,
      updated_at   TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY payments_user_id_created_at_index (user_id, created_at),
      CONSTRAINT payments_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code             VARCHAR(12) NOT NULL,
      user_id          BIGINT UNSIGNED NULL,
      offer_id         BIGINT UNSIGNED NULL,
      partner_id       BIGINT UNSIGNED NULL,
      group_id         BIGINT UNSIGNED NULL,
      offer_title      VARCHAR(120) NOT NULL,
      partner_name     VARCHAR(120) NOT NULL,
      people           SMALLINT UNSIGNED NOT NULL,
      plan_key         VARCHAR(20) NOT NULL,
      pay_method       VARCHAR(10) NOT NULL,
      unit_price_cents INT UNSIGNED NULL,
      unit_credits     INT UNSIGNED NULL,
      discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      subtotal_cents   INT UNSIGNED NOT NULL DEFAULT 0,
      discount_cents   INT UNSIGNED NOT NULL DEFAULT 0,
      total_cents      INT UNSIGNED NOT NULL DEFAULT 0,
      subtotal_credits INT UNSIGNED NOT NULL DEFAULT 0,
      total_credits    INT UNSIGNED NOT NULL DEFAULT 0,
      status           VARCHAR(12) NOT NULL DEFAULT 'confirmed',
      preferred_date   DATE NULL,
      valid_until      DATETIME NOT NULL,
      redeemed_at      DATETIME NULL,
      redeemed_by      BIGINT UNSIGNED NULL,
      cancelled_at     DATETIME NULL,
      payment_id       BIGINT UNSIGNED NULL,
      created_at       TIMESTAMP NULL,
      updated_at       TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY bookings_code_unique (code),
      KEY bookings_offer_id_foreign (offer_id),
      KEY bookings_group_id_foreign (group_id),
      KEY bookings_redeemed_by_foreign (redeemed_by),
      KEY bookings_payment_id_foreign (payment_id),
      KEY bookings_user_id_status_index (user_id, status),
      KEY bookings_partner_id_status_index (partner_id, status),
      CONSTRAINT bookings_group_id_foreign
        FOREIGN KEY (group_id) REFERENCES friend_groups (id) ON DELETE SET NULL,
      CONSTRAINT bookings_offer_id_foreign
        FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE SET NULL,
      CONSTRAINT bookings_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL,
      CONSTRAINT bookings_payment_id_foreign
        FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL,
      CONSTRAINT bookings_redeemed_by_foreign
        FOREIGN KEY (redeemed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT bookings_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_feedback (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      booking_id BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NULL,
      partner_id BIGINT UNSIGNED NULL,
      rating     TINYINT UNSIGNED NOT NULL,
      comment    VARCHAR(500) NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY booking_feedback_booking_id_unique (booking_id),
      KEY booking_feedback_user_id_foreign (user_id),
      KEY booking_feedback_partner_id_foreign (partner_id),
      CONSTRAINT booking_feedback_booking_id_foreign
        FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
      CONSTRAINT booking_feedback_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL,
      CONSTRAINT booking_feedback_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_shares (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      booking_id  BIGINT UNSIGNED NOT NULL,
      debtor_id   BIGINT UNSIGNED NOT NULL,
      creditor_id BIGINT UNSIGNED NOT NULL,
      credits     INT UNSIGNED NOT NULL,
      status      VARCHAR(10) NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMP NULL,
      settled_at  TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY booking_shares_booking_id_debtor_id_unique (booking_id, debtor_id),
      KEY booking_shares_debtor_id_foreign (debtor_id),
      KEY booking_shares_creditor_id_foreign (creditor_id),
      CONSTRAINT booking_shares_booking_id_foreign
        FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
      CONSTRAINT booking_shares_creditor_id_foreign
        FOREIGN KEY (creditor_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT booking_shares_debtor_id_foreign
        FOREIGN KEY (debtor_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS checkins (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id       BIGINT UNSIGNED NOT NULL,
      partner_id    BIGINT UNSIGNED NOT NULL,
      method        VARCHAR(10) NOT NULL,
      staff_user_id BIGINT UNSIGNED NULL,
      stamped       TINYINT(1) NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY checkins_user_id_foreign (user_id),
      KEY checkins_staff_user_id_foreign (staff_user_id),
      KEY checkins_partner_id_created_at_index (partner_id, created_at),
      CONSTRAINT checkins_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE,
      CONSTRAINT checkins_staff_user_id_foreign
        FOREIGN KEY (staff_user_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT checkins_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS voucher_batches (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      label      VARCHAR(120) NOT NULL,
      retailer   VARCHAR(80) NULL,
      credits    INT UNSIGNED NOT NULL,
      quantity   INT UNSIGNED NOT NULL,
      expires_at DATETIME NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY voucher_batches_created_by_foreign (created_by),
      CONSTRAINT voucher_batches_created_by_foreign
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      batch_id    BIGINT UNSIGNED NOT NULL,
      code        VARCHAR(20) NOT NULL,
      credits     INT UNSIGNED NOT NULL,
      expires_at  DATETIME NULL,
      redeemed_by BIGINT UNSIGNED NULL,
      redeemed_at DATETIME NULL,
      disabled_at DATETIME NULL,
      created_at  TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY vouchers_code_unique (code),
      KEY vouchers_batch_id_foreign (batch_id),
      KEY vouchers_redeemed_by_foreign (redeemed_by),
      CONSTRAINT vouchers_batch_id_foreign
        FOREIGN KEY (batch_id) REFERENCES voucher_batches (id) ON DELETE CASCADE,
      CONSTRAINT vouchers_redeemed_by_foreign
        FOREIGN KEY (redeemed_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id       BIGINT UNSIGNED NOT NULL,
      amount        INT NOT NULL,
      balance_after INT NOT NULL,
      kind          VARCHAR(20) NOT NULL,
      description   VARCHAR(200) NOT NULL,
      booking_id    BIGINT UNSIGNED NULL,
      payment_id    BIGINT UNSIGNED NULL,
      voucher_id    BIGINT UNSIGNED NULL,
      created_at    TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY credit_transactions_booking_id_foreign (booking_id),
      KEY credit_transactions_payment_id_foreign (payment_id),
      KEY credit_transactions_voucher_id_foreign (voucher_id),
      KEY credit_transactions_user_id_id_index (user_id, id),
      CONSTRAINT credit_transactions_booking_id_foreign
        FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL,
      CONSTRAINT credit_transactions_payment_id_foreign
        FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL,
      CONSTRAINT credit_transactions_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT credit_transactions_voucher_id_foreign
        FOREIGN KEY (voucher_id) REFERENCES vouchers (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_lots (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id               BIGINT UNSIGNED NOT NULL,
      credit_transaction_id BIGINT UNSIGNED NULL,
      amount                INT NOT NULL,
      remaining             INT NOT NULL,
      expires_at            TIMESTAMP NOT NULL,
      created_at            TIMESTAMP NULL,
      reminded_30_at        TIMESTAMP NULL,
      reminded_7_at         TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY credit_lots_credit_transaction_id_foreign (credit_transaction_id),
      KEY credit_lots_user_id_expires_at_index (user_id, expires_at),
      KEY credit_lots_expires_at_remaining_index (expires_at, remaining),
      CONSTRAINT credit_lots_credit_transaction_id_foreign
        FOREIGN KEY (credit_transaction_id) REFERENCES credit_transactions (id) ON DELETE SET NULL,
      CONSTRAINT credit_lots_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_lot_uses (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      credit_lot_id         BIGINT UNSIGNED NOT NULL,
      credit_transaction_id BIGINT UNSIGNED NOT NULL,
      amount                INT NOT NULL,
      PRIMARY KEY (id),
      KEY credit_lot_uses_credit_lot_id_foreign (credit_lot_id),
      KEY credit_lot_uses_credit_transaction_id_index (credit_transaction_id),
      CONSTRAINT credit_lot_uses_credit_lot_id_foreign
        FOREIGN KEY (credit_lot_id) REFERENCES credit_lots (id) ON DELETE CASCADE,
      CONSTRAINT credit_lot_uses_credit_transaction_id_foreign
        FOREIGN KEY (credit_transaction_id) REFERENCES credit_transactions (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`key\`      VARCHAR(40) NOT NULL,
      enabled    TINYINT(1) NOT NULL DEFAULT 0,
      value      VARCHAR(40) NULL,
      created_at TIMESTAMP NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY feature_flags_key_unique (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feature_previews (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      \`key\`      VARCHAR(40) NOT NULL,
      enabled    TINYINT(1) NULL,
      value      VARCHAR(40) NULL,
      created_at TIMESTAMP NULL,
      updated_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY feature_previews_user_id_key_unique (user_id, \`key\`),
      CONSTRAINT feature_previews_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_polls (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id   BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      title      VARCHAR(120) NOT NULL,
      closed_at  TIMESTAMP NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY group_polls_group_id_foreign (group_id),
      KEY group_polls_created_by_foreign (created_by),
      CONSTRAINT group_polls_created_by_foreign
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT group_polls_group_id_foreign
        FOREIGN KEY (group_id) REFERENCES friend_groups (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_poll_options (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      poll_id     BIGINT UNSIGNED NOT NULL,
      offer_id    BIGINT UNSIGNED NULL,
      offer_title VARCHAR(120) NOT NULL,
      day         DATE NULL,
      PRIMARY KEY (id),
      KEY group_poll_options_poll_id_foreign (poll_id),
      KEY group_poll_options_offer_id_foreign (offer_id),
      CONSTRAINT group_poll_options_offer_id_foreign
        FOREIGN KEY (offer_id) REFERENCES offers (id) ON DELETE SET NULL,
      CONSTRAINT group_poll_options_poll_id_foreign
        FOREIGN KEY (poll_id) REFERENCES group_polls (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_poll_votes (
      poll_id    BIGINT UNSIGNED NOT NULL,
      option_id  BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (poll_id, user_id),
      KEY group_poll_votes_option_id_foreign (option_id),
      KEY group_poll_votes_user_id_foreign (user_id),
      CONSTRAINT group_poll_votes_option_id_foreign
        FOREIGN KEY (option_id) REFERENCES group_poll_options (id) ON DELETE CASCADE,
      CONSTRAINT group_poll_votes_poll_id_foreign
        FOREIGN KEY (poll_id) REFERENCES group_polls (id) ON DELETE CASCADE,
      CONSTRAINT group_poll_votes_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_staff (
      partner_id BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      role       VARCHAR(20) NOT NULL DEFAULT 'staff',
      created_at TIMESTAMP NULL,
      PRIMARY KEY (partner_id, user_id),
      KEY partner_staff_user_id_foreign (user_id),
      CONSTRAINT partner_staff_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE,
      CONSTRAINT partner_staff_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_wishes (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name       VARCHAR(120) NOT NULL,
      note       VARCHAR(300) NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      KEY partner_wishes_created_by_foreign (created_by),
      CONSTRAINT partner_wishes_created_by_foreign
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_wish_votes (
      wish_id    BIGINT UNSIGNED NOT NULL,
      user_id    BIGINT UNSIGNED NOT NULL,
      weight     TINYINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (wish_id, user_id),
      KEY partner_wish_votes_user_id_foreign (user_id),
      CONSTRAINT partner_wish_votes_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT partner_wish_votes_wish_id_foreign
        FOREIGN KEY (wish_id) REFERENCES partner_wishes (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stamps (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      partner_id BIGINT UNSIGNED NULL,
      checkin_id BIGINT UNSIGNED NULL,
      stamp_day  DATE NOT NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY stamps_user_id_partner_id_stamp_day_unique (user_id, partner_id, stamp_day),
      KEY stamps_partner_id_foreign (partner_id),
      KEY stamps_checkin_id_foreign (checkin_id),
      CONSTRAINT stamps_checkin_id_foreign
        FOREIGN KEY (checkin_id) REFERENCES checkins (id) ON DELETE SET NULL,
      CONSTRAINT stamps_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL,
      CONSTRAINT stamps_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS testphase_challenges (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      type           VARCHAR(12) NOT NULL,
      title          VARCHAR(120) NOT NULL,
      description    VARCHAR(300) NULL,
      metric         VARCHAR(24) NOT NULL,
      target         SMALLINT UNSIGNED NOT NULL,
      reward_credits INT UNSIGNED NOT NULL,
      period         VARCHAR(8) NOT NULL,
      starts_at      DATE NULL,
      ends_at        DATE NULL,
      partner_id     BIGINT UNSIGNED NULL,
      interest_id    BIGINT UNSIGNED NULL,
      match_text     VARCHAR(60) NULL,
      offer_kind     VARCHAR(20) NULL,
      plans          JSON NULL,
      is_active      TINYINT(1) NOT NULL DEFAULT 1,
      sort           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at     TIMESTAMP NULL,
      updated_at     TIMESTAMP NULL,
      is_secret      TINYINT(1) NOT NULL DEFAULT 0,
      is_choice      TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY testphase_challenges_partner_id_foreign (partner_id),
      KEY testphase_challenges_interest_id_foreign (interest_id),
      CONSTRAINT testphase_challenges_interest_id_foreign
        FOREIGN KEY (interest_id) REFERENCES interests (id) ON DELETE SET NULL,
      CONSTRAINT testphase_challenges_partner_id_foreign
        FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS testphase_choices (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id      BIGINT UNSIGNED NOT NULL,
      challenge_id BIGINT UNSIGNED NOT NULL,
      period       VARCHAR(20) NOT NULL,
      created_at   TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY testphase_choices_user_id_challenge_id_period_unique (user_id, challenge_id, period),
      KEY testphase_choices_challenge_id_foreign (challenge_id),
      CONSTRAINT testphase_choices_challenge_id_foreign
        FOREIGN KEY (challenge_id) REFERENCES testphase_challenges (id) ON DELETE CASCADE,
      CONSTRAINT testphase_choices_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS testphase_claims (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id    BIGINT UNSIGNED NOT NULL,
      \`key\`      VARCHAR(60) NOT NULL,
      period     VARCHAR(20) NOT NULL,
      credits    INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NULL,
      PRIMARY KEY (id),
      UNIQUE KEY testphase_claims_user_id_key_period_unique (user_id, \`key\`, period),
      CONSTRAINT testphase_claims_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

}
