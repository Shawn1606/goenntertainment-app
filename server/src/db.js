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
    ['two_factor_method', 'VARCHAR(10) NULL', 'terms_accepted_at'],
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
}
