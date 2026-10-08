-- Goenntertainment – Datenbank-Schema (MySQL 8 / MariaDB)
--
-- Portiert aus den Laravel-Migrations. Baut die DB ohne Laravel auf.
-- Idempotent: `CREATE TABLE IF NOT EXISTS` fasst bestehende Tabellen nicht an,
-- man kann es also gefahrlos gegen eine bereits von Laravel angelegte DB laufen lassen.
--
-- Anlegen der DB (einmalig) + einspielen:
--   mysql -uroot -e "CREATE DATABASE IF NOT EXISTS goenntertainment CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
--   mysql -uroot goenntertainment < server/schema.sql
--
-- Danach Beispiel-Interessen + Admin: `npm run seed` (siehe server/src/seed.js).

SET NAMES utf8mb4;
SET foreign_key_checks = 1;

-- Nutzer (inkl. Profilfelder aus der spaeteren Migration)
CREATE TABLE IF NOT EXISTS users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name              VARCHAR(255)    NOT NULL,
  username          VARCHAR(255)    NULL,
  account_type      VARCHAR(255)    NULL,               -- Kontostufe, die GILT: standard|creator|business|business_plus (siehe src/accounts.js)
  -- Die Stufe, die ein ADMIN von Hand vergeben hat (Testkonten, Partner,
  -- Wiedergutmachungen). NULL = keine vergeben.
  --
  -- Warum das eine zweite Spalte braucht: Seit den Abos schreiben ZWEI Quellen
  -- auf `account_type` – der Admin und der Store-Webhook. Ohne die Trennung
  -- ueberschreibt die eine die andere. Konkret: Ein Partnerkonto hat dauerhaft
  -- Business und probiert einen Monat Business Plus; laeuft der aus, meldet
  -- RevenueCat "keine Entitlements", und `account_type` fiele auf 'standard' –
  -- die dauerhafte Vergabe waere still verschwunden.
  --
  -- Deshalb gilt: `account_type` = das Bessere aus dieser Spalte und dem
  -- laufenden Abo, ausgerechnet in src/subscriptions.js. Alles, was Rechte
  -- prueft, liest weiter nur `account_type` und muss davon nichts wissen.
  granted_account_type VARCHAR(255) NULL,
  google_id         VARCHAR(255)    NULL,
  avatar            VARCHAR(255)    NULL,               -- Profilbild: eigener Upload ('avatars/…') ODER fremde URL (Google), siehe src/media.js
  banner            VARCHAR(255)    NULL,               -- Bild hinter der Profil-Karte; wird in der App weichgezeichnet gezeigt
  email             VARCHAR(255)    NOT NULL,
  email_verified_at TIMESTAMP       NULL,
  password          VARCHAR(255)    NULL,          -- nullable: reine Google-Konten
  is_admin          TINYINT(1)      NOT NULL DEFAULT 0, -- 1 = Admin (darf jedes Event loeschen, sieht Admin-Tab)
  banned_until      DATETIME        NULL,               -- NULL = aktiv; Zeitpunkt = gesperrt bis dahin (Bann = weit in der Zukunft)
  ban_reason        VARCHAR(255)    NULL,               -- Grund der Sperre (wird dem Nutzer beim Login gezeigt)
  -- Welchen Stand der Nutzungsbedingungen dieses Konto bestaetigt hat (siehe
  -- src/domain/legal.ts in der App). Die VERSION und nicht bloss ein Ja/Nein:
  -- Nur damit laesst sich nach einer Aenderung erkennen, wer noch dem alten
  -- Stand zugestimmt hat. NULL = Bestandskonto von vor der Zustimmung.
  terms_version     VARCHAR(20)     NULL,
  terms_accepted_at DATETIME        NULL,
  -- The minimum age confirmed at sign-up and when (F-14; the age comes from shared/legal.json,
  -- Laravel's sign-up refuses a registration without it). How age is verified beyond this
  -- confirmation is an operator decision. NULL = an account from before the confirmation.
  min_age_confirmed    TINYINT UNSIGNED NULL,
  min_age_confirmed_at DATETIME         NULL,
  -- Zwei-Faktor-Anmeldung (bedient von Laravel, api/app/Support/TwoFactor.php).
  -- `two_factor_method` ist der EINZIGE Schalter: NULL = aus, 'email' | 'totp' =
  -- an. Ein gesetztes Secret bei NULL-Methode ist eine angefangene, noch nicht
  -- bestaetigte Einrichtung und schaltet nichts ein.
  -- Secret und Wiederherstellungscodes stehen VERSCHLUESSELT darin (Laravels
  -- Crypt mit APP_KEY) – ein Datenbank-Abzug allein verraet sie nicht. Die Codes
  -- sind zusaetzlich gehasht: Selbst entschluesselt steht dort kein
  -- benutzbarer Code.
  -- `two_factor_last_step` ist der Replay-Schutz fuer TOTP: das zuletzt
  -- angenommene 30-Sekunden-Fenster. Ein Code gilt nur einmal.
  two_factor_method         VARCHAR(10) NULL,
  two_factor_secret         TEXT        NULL,
  two_factor_recovery_codes TEXT        NULL,
  two_factor_confirmed_at   DATETIME    NULL,
  two_factor_last_step      BIGINT      NULL,
  remember_token    VARCHAR(100)    NULL,
  created_at        TIMESTAMP       NULL,
  updated_at        TIMESTAMP       NULL,
  -- Marketplace club plan and credits balance (the Laravel migrations in api/database/migrations
  -- add them in this order).
  club_plan                 VARCHAR(20) NOT NULL DEFAULT 'free',
  club_since                DATETIME NULL,
  club_renews_at            DATETIME NULL,
  club_cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
  credits_balance           INT NOT NULL DEFAULT 0,
  club_interval             VARCHAR(5) NOT NULL DEFAULT 'month',
  club_credits_next_at      DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_username_unique (username),
  UNIQUE KEY users_google_id_unique (google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Passwort-Zuruecksetzen (E-Mail -> Token)
-- No longer written: the reset works by a mailed code (purpose 'reset' in
-- two_factor_challenges, F-09). The table stays until its removal from every
-- schema copy (backlog).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  email      VARCHAR(255) NOT NULL,
  token      VARCHAR(255) NOT NULL,
  created_at TIMESTAMP    NULL,
  PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sanctum-Tokens (persoenliche Zugriffs-Tokens fuer die App)
CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tokenable_type VARCHAR(255)    NOT NULL,
  tokenable_id   BIGINT UNSIGNED NOT NULL,
  name           TEXT            NOT NULL,
  token          VARCHAR(64)     NOT NULL,
  abilities      TEXT            NULL,
  last_used_at   TIMESTAMP       NULL,
  expires_at     TIMESTAMP       NULL,
  created_at     TIMESTAMP       NULL,
  updated_at     TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY personal_access_tokens_token_unique (token),
  KEY personal_access_tokens_tokenable_idx (tokenable_type, tokenable_id),
  KEY personal_access_tokens_expires_at_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Laravel's database cache store (CACHE_STORE=database): the rate-limit counters of the sign-in,
-- sign-up, password and two-factor routes, including the per-account caps across addresses, and
-- the two-factor failure count. In the database rather than in a file inside the api container,
-- because a file counter loses increments under concurrent requests and starts again from zero
-- whenever the container is recreated. Same columns, types and index names as Laravel's stock
-- migration (api/database/migrations/0001_01_01_000001_create_cache_table.php); `expiration` is a
-- Unix timestamp. Keys are hashes, values are counts.
CREATE TABLE IF NOT EXISTS cache (
  `key`      VARCHAR(255) NOT NULL,
  value      MEDIUMTEXT   NOT NULL,
  expiration BIGINT       NOT NULL,
  PRIMARY KEY (`key`),
  KEY cache_expiration_index (expiration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cache_locks (
  `key`      VARCHAR(255) NOT NULL,
  owner      VARCHAR(255) NOT NULL,
  expiration BIGINT       NOT NULL,
  PRIMARY KEY (`key`),
  KEY cache_locks_expiration_index (expiration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Offene Zwei-Faktor-Vorgaenge: ein Schritt, der auf einen Code wartet.
--
-- purpose:
--   'login'   – Passwort stimmte, jetzt fehlt der zweite Faktor (POST /login).
--   'setup'   – E-Mail-Code beim Einschalten der E-Mail-Methode.
--   'confirm' – E-Mail-Code fuer eine heikle Aktion bei aktiver E-Mail-Methode
--               (2FA ausschalten, neue Wiederherstellungscodes, Konto loeschen).
--   'delete'  – Freigabe von Laravel an Node: „diese Person hat das Loeschen
--               vollstaendig bestaetigt" (siehe server/src/routes/internal.js).
--               Kein Code, nur der Token; lebt zwei Minuten.
--   'reset'   – a password reset code (POST /forgot-password, signed out); its token is
--               never handed out (api/app/Support/PasswordReset.php). The former link
--               tokens table, password_reset_tokens, is no longer written.
--   'new_email' – a code mailed to the NEW address of an e-mail change; the address takes
--               effect only with it. The address is not stored: the code's HMAC covers it
--               (api/app/Support/AddressCode.php).
--   'first_pw' – a code mailed to the account's own address before an account without a
--               password sets its first one (same file).
--
-- Gespeichert werden nur Hashes: `token_hash` = sha256 des Tokens, den die App
-- in der Hand haelt; `code_hash` = HMAC des Codes (Schluessel APP_KEY). Wer die
-- Tabelle liest, kann damit weder einen Vorgang uebernehmen noch einen Code
-- ablesen.
--
-- `attempts` zaehlt Fehlversuche; ab 5 ist der Vorgang verbraucht. Die Zeile
-- bleibt bis zum Ablauf stehen, damit jeder weitere Versuch dieselbe klare
-- Antwort bekommt („Zu viele Versuche") statt eines raetselhaften „abgelaufen".
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Interessen
CREATE TABLE IF NOT EXISTS interests (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(255)    NOT NULL,
  slug       VARCHAR(255)    NOT NULL,
  icon       VARCHAR(255)    NULL,
  created_at TIMESTAMP       NULL,
  updated_at TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY interests_slug_unique (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nutzer <-> Interessen (n:m)
CREATE TABLE IF NOT EXISTS interest_user (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  interest_id BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP       NULL,
  updated_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY interest_user_unique (user_id, interest_id),
  KEY interest_user_interest_id_idx (interest_id),
  CONSTRAINT interest_user_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT interest_user_interest_id_fk
    FOREIGN KEY (interest_id) REFERENCES interests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Marketplace partners and their offers (api/database/migrations). Here, before the chat tables,
-- because chat_messages.shared_offer_id refers to offers; the other marketplace tables follow at
-- the end of this file.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aktivitaeten
CREATE TABLE IF NOT EXISTS activities (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,             -- Host
  title       VARCHAR(255)    NOT NULL,
  description TEXT            NOT NULL,
  location    VARCHAR(255)    NOT NULL,
  starts_at   DATETIME        NOT NULL,
  banner_path VARCHAR(255)    NULL,
  max_participants INT UNSIGNED NULL,               -- NULL = unbegrenzt
  boosted_until DATETIME      NULL,                 -- hervorgehoben bis (Business-Stufen); NULL = normal
  -- 1 = Dauerangebot ohne festen Termin (Bowling, Trampolinhalle, Freibad).
  --
  -- Bei diesen Zeilen ist `starts_at` BEDEUTUNGSLOS: Es traegt nur den
  -- Anlege-Zeitpunkt, weil die Spalte NOT NULL ist. Die App zeigt ihn nicht und
  -- rechnet nicht mit ihm, sondern liest dieses Kennzeichen und behandelt den
  -- Eintrag als „immer moeglich" (src/domain/activity-filter.ts).
  is_permanent  TINYINT(1)    NOT NULL DEFAULT 0,
  created_at  TIMESTAMP       NULL,
  updated_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY activities_user_id_idx (user_id),
  CONSTRAINT activities_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aktivitaet <-> Interessen (n:m)
CREATE TABLE IF NOT EXISTS activity_interest (
  activity_id BIGINT UNSIGNED NOT NULL,
  interest_id BIGINT UNSIGNED NOT NULL,
  -- Rangfolge der Kategorien EINES Events; 0 = die fuehrende.
  --
  -- Die App unterteilt ihre Listen nach der fuehrenden Kategorie (siehe
  -- src/domain/interest-group.ts). Ohne diese Spalte entschied beim Auslesen das
  -- Alphabet: Ein Salsa-Abend mit [Tanzen, Party & Club] landete unter
  -- "Party & Club", weil P vor T kommt – und die Absicht des Importers
  -- (spezifisch vor allgemein) war weg.
  `rank`      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_id, interest_id),
  KEY activity_interest_interest_id_idx (interest_id),
  CONSTRAINT activity_interest_activity_id_fk
    FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
  CONSTRAINT activity_interest_interest_id_fk
    FOREIGN KEY (interest_id) REFERENCES interests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Teilnehmer (wer ist einer Aktivitaet beigetreten); created_at = Beitritts-Zeitpunkt
CREATE TABLE IF NOT EXISTS activity_user (
  activity_id BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP       NULL,
  updated_at  TIMESTAMP       NULL,
  PRIMARY KEY (activity_id, user_id),
  KEY activity_user_user_id_idx (user_id),
  CONSTRAINT activity_user_activity_id_fk
    FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
  CONSTRAINT activity_user_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aufrufe je Aktivitaet: eine Zeile pro Person und Event. Dadurch zaehlt die
-- Statistik "von wie vielen Leuten gesehen" statt roher Klicks.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verlauf: welche Events ein:e Nutzer:in erstellt/besucht hat. Enthaelt einen
-- Schnappschuss (Titel/Ort/Datum/Banner), damit der Eintrag auch nach dem
-- Loeschen des Events angezeigt werden kann. `activity_id` -> SET NULL beim
-- Loeschen (Verweis weg, Schnappschuss bleibt). `removed_at` = Zeitpunkt, ab dem
-- die 7-Tage-Frist laeuft (Event geloescht ODER Nutzer:in ausgetreten); NULL =
-- noch aktiv (bleibt dauerhaft sichtbar, solange das Event existiert).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beweismittel je Sperr-Aktion (Bann/Timeout): Grund + optionaler Screenshot.
-- Bleibt als Nachweis erhalten, auch nach Aufheben der Sperre.
-- `source` = 'admin' (von Hand) oder 'ai' (automatisch durch die KI-Moderation;
-- dann ist admin_id NULL und image_path enthaelt das beanstandete Bild).
CREATE TABLE IF NOT EXISTS ban_evidence (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,             -- betroffener Nutzer
  admin_id     BIGINT UNSIGNED NULL,                 -- wer die Sperre gesetzt hat
  source       VARCHAR(10)     NOT NULL DEFAULT 'admin', -- 'admin' | 'ai'
  action       VARCHAR(20)     NOT NULL,             -- 'ban' | 'timeout'
  reason       VARCHAR(255)    NOT NULL,
  banned_until DATETIME        NULL,                 -- bei Timeout: Ende
  image_path   VARCHAR(255)    NULL,                 -- Screenshot/Foto als Beweis
  created_at   TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY ban_evidence_user_id_idx (user_id),
  CONSTRAINT ban_evidence_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ban_evidence_admin_id_fk
    FOREIGN KEY (admin_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Berichte der KI-Verifizierung (Jugendschutz). Jede Pruefung eines Nutzer-
-- Inhalts landet hier – auch die unauffaelligen, damit die Trefferquote und
-- jede automatische Sperre nachvollziehbar bleiben.
--   verdict: 'ok' | 'auffaellig' | 'abgelehnt' | 'refusal' | 'error'
--   severity: 0 unbedenklich · 1 grenzwertig · 2 nicht jugendfrei · 3 schwer
--   action: 'none' (durchgelassen) | 'blocked' (abgelehnt) | 'timeout' (+ Sperre)
-- user_id -> SET NULL only as a fallback: deleting an account (server/src/account-deletion.js,
-- F-16) deletes the person's rows and their images with it. server/src/retention.js deletes every
-- row older than MODERATION_REPORT_RETENTION_DAYS, which covers rows left without an account by
-- earlier deletions, and clears images older than EVIDENCE_RETENTION_DAYS. Both settings are
-- required in production; where they are unset, nothing is pruned.
CREATE TABLE IF NOT EXISTS moderation_reports (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NULL,
  context     VARCHAR(20)     NOT NULL,             -- 'activity'
  verdict     VARCHAR(20)     NOT NULL,
  severity    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  categories  VARCHAR(255)    NULL,                 -- z. B. 'sexuell,nacktheit'
  fields      VARCHAR(255)    NULL,                 -- betroffene Felder
  reason      VARCHAR(500)    NULL,                 -- Begruendung der KI
  action      VARCHAR(20)     NOT NULL,
  title       VARCHAR(255)    NULL,                 -- geprueftes Material (Schnappschuss)
  body        TEXT            NULL,
  interests   VARCHAR(500)    NULL,
  image_path  VARCHAR(255)    NULL,                 -- nur bei automatischer Sperre
  model       VARCHAR(60)     NULL,
  latency_ms  INT UNSIGNED    NULL,
  created_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY moderation_reports_user_id_idx (user_id),
  KEY moderation_reports_created_at_idx (created_at),
  CONSTRAINT moderation_reports_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI moderation calls per UTC day (F-07): the counter of the global budget
-- MODERATION_DAILY_CALL_LIMIT (server/src/moderation.js). One row per day; every call to the model
-- first reserves one unit here, and a reservation beyond the limit is refused. Counts only, no user
-- data. server/src/retention.js deletes the rows of past days.
CREATE TABLE IF NOT EXISTS moderation_call_counts (
  day   DATE         NOT NULL,                       -- UTC
  calls INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aktive Tage je Nutzer:in – Grundlage der Serie ("Streak").
-- Eine Zeile pro Person und Kalendertag, an dem die App benutzt wurde. Der Tag
-- kommt vom Gerät (Header X-Local-Date), damit die Serie in der Zeitzone der
-- Nutzer:in stimmt und nicht in UTC; ohne Header faellt der Server auf sein
-- eigenes Datum zurueck. Bewusst OHNE Zeit und ohne Zaehler: Wir wollen nur
-- wissen "an diesem Tag war jemand da", nicht wie oft oder wie lange.
CREATE TABLE IF NOT EXISTS user_active_days (
  user_id BIGINT UNSIGNED NOT NULL,
  day     DATE            NOT NULL,
  PRIMARY KEY (user_id, day),
  KEY user_active_days_day_idx (day),
  CONSTRAINT user_active_days_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beitraege auf der oeffentlichen Profilseite ("Community Post").
-- Nur Konten mit oeffentlichem Profil (ab Creator, siehe src/accounts.js)
-- duerfen schreiben; gelesen werden sie von allen. Text ist Pflicht, das Bild
-- optional. Beides geht vor dem Speichern durch die KI-Verifizierung
-- (moderation.js, context 'post') – wie bei den Events.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Punkte-Buchungen ("Praemien"). Eine Zeile pro Ereignis, das Punkte bringt –
-- derzeit nur 'activity' (10 Punkte je erstelltem Event, siehe src/rewards.js).
-- `activity_id` -> SET NULL beim Loeschen: Verdiente Punkte bleiben verdient,
-- auch wenn das Event weg ist. Der eindeutige Schluessel macht die Buchung
-- idempotent (kein doppeltes Gutschreiben beim Nachtragen).
CREATE TABLE IF NOT EXISTS reward_points (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  points      INT             NOT NULL,
  reason      VARCHAR(30)     NOT NULL,             -- 'activity'
  activity_id BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY reward_points_reason_ref_uq (user_id, reason, activity_id),
  KEY reward_points_user_id_idx (user_id),
  CONSTRAINT reward_points_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT reward_points_activity_id_fk
    FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Eingeloeste Coupons. `coupon_slug` verweist auf den Katalog im Code
-- (src/rewards.js) – der Preis steht als `points` mit in der Zeile, damit eine
-- spaetere Preisaenderung alte Einloesungen nicht rueckwirkend verteuert.
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  coupon_slug VARCHAR(40)     NOT NULL,
  code        VARCHAR(40)     NOT NULL,             -- wird beim Partner vorgezeigt
  points      INT             NOT NULL,
  created_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY reward_redemptions_code_uq (code),
  KEY reward_redemptions_user_id_idx (user_id),
  CONSTRAINT reward_redemptions_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Storys: Bild + optionale Unterschrift, laeuft nach 24 h ab (siehe
-- src/routes/stories.js). Anlegen darf, wer ein oeffentliches Profil hat
-- (ab Creator); gelesen wird von allen Angemeldeten.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wer welche Story gesehen hat – Grundlage der Reihenfolge in der Story-Leiste
-- (ungesehene zuerst).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Freundschaften. EINE Zeile pro Beziehung, keine Spiegelzeile: dadurch kann
-- eine Freundschaft nie halb bestehen. Wer die Freunde einer Person sucht, muss
-- beide Spalten pruefen (siehe src/routes/friends.js).
--   status: 'pending' (angefragt) | 'accepted' (bestaetigt)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gruppen im Freunde-Bereich. Heisst `friend_groups` und nicht `groups`, weil
-- GROUPS in MySQL 8 ein reserviertes Wort ist (Fenster-Funktionen) und jede
-- Abfrage sonst Backticks braeuchte.
CREATE TABLE IF NOT EXISTS friend_groups (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(60)     NOT NULL,
  description VARCHAR(200)    NULL,
  created_at  TIMESTAMP       NULL,
  updated_at  TIMESTAMP       NULL,
  -- The marketplace's invitation code (api/database/migrations/2026_10_01_000300_group_invites_and_offer_sharing.php).
  invite_code VARCHAR(12)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY friend_groups_invite_code_unique (invite_code),
  KEY friend_groups_owner_idx (owner_id),
  CONSTRAINT friend_groups_owner_fk
    FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anfragen auf eine hoehere Kontostufe (Creator, Business, Business Plus).
-- Die Stufe schaltet Rechte frei, deshalb gibt sie sich niemand selbst: Die
-- Person fragt an (POST /api/me/upgrade-request), ein Admin bestaetigt oder
-- lehnt ab (siehe src/routes/admin.js).
--
-- GENAU EINE Zeile pro Konto (UNIQUE user_id), die bei jeder neuen Anfrage
-- ueberschrieben wird. Ein Verlauf aller je gestellten Anfragen waere eine
-- zweite Wahrheit neben `users.account_type` – und die Frage, die das
-- Admin-Panel stellt, ist immer "was liegt JETZT offen". Der Preis: Wer
-- zweimal fragt, hinterlaesst nur die letzte Anfrage. Dafuer kann es per
-- Datenbank nie zwei offene Anfragen desselben Kontos geben, ohne dass der
-- Server vorher nachsehen muss.
--   status: 'pending' (liegt offen) | 'approved' (bestaetigt) | 'rejected' (abgelehnt)
CREATE TABLE IF NOT EXISTS account_upgrade_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  requested_type VARCHAR(20)     NOT NULL,          -- creator|business|business_plus
  -- Monats- oder Jahresabo, wie im Upgrade-Bildschirm gewaehlt. Kein ENUM,
  -- sondern VARCHAR wie `requested_type`: Eingelesen wird der Wert ohnehin in
  -- src/subscriptions.js (normalizeBillingPeriod), und ein dritter Rhythmus
  -- braucht dann kein ALTER TABLE. Aendert an den Rechten NICHTS – die haengen
  -- allein an der Stufe.
  billing_period VARCHAR(10)     NOT NULL DEFAULT 'monthly',  -- monthly|yearly
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  message        VARCHAR(500)    NULL,              -- Begruendung der Person (freiwillig)
  decided_by     BIGINT UNSIGNED NULL,              -- Admin, der entschieden hat
  decided_at     DATETIME        NULL,
  decision_note  VARCHAR(255)    NULL,              -- Grund der Ablehnung (freiwillig)
  created_at     TIMESTAMP       NULL,
  updated_at     TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY account_upgrade_requests_user_uq (user_id),
  KEY account_upgrade_requests_status_idx (status, created_at),
  CONSTRAINT account_upgrade_requests_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  -- Der Admin darf geloescht werden, die Entscheidung bleibt bestehen.
  CONSTRAINT account_upgrade_requests_admin_fk
    FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Laufende Abos (In-App-Kauf ueber App Store / Play Store, gemeldet von
-- RevenueCat). Eine Zeile pro Konto UND Entitlement, im Stand von JETZT – kein
-- Verlauf. Der Verlauf steht im Store und bei RevenueCat; hier interessiert nur
-- die Frage, die der Server bei jeder Anfrage beantworten muss: Was ist bezahlt?
--
-- WARUM `entitlement` UND NICHT DIE PRODUKT-ID
-- Dasselbe Abo heisst in beiden Laeden anders (`goenn.creator.monthly` bei
-- Apple, `goenn_creator_monthly` bei Google), und ein spaeteres Jahresabo waere
-- eine dritte ID fuer dieselbe Stufe. Das Entitlement ist der gemeinsame Name –
-- wortgleich mit der Kontostufe (siehe src/domain/subscription.ts in der App).
-- Die `product_id` steht nur zum Nachsehen mit in der Zeile.
--
-- WARUM `event_at`
-- Webhooks kommen nicht zwangslaeufig in der Reihenfolge an, in der sie
-- entstanden sind. Ein verspaetetes "abgelaufen" nach einem schon verarbeiteten
-- "verlaengert" wuerde ein bezahltes Konto abschalten. Deshalb wird ein Ereignis
-- verworfen, das aelter ist als das zuletzt verarbeitete (src/subscriptions.js).
--   status: 'active' (bezahlt) | 'grace' (Zahlung haengt, Zugang bleibt) | 'expired' (vorbei)
CREATE TABLE IF NOT EXISTS subscriptions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  entitlement VARCHAR(20)     NOT NULL,          -- creator|business|business_plus
  provider    VARCHAR(20)     NOT NULL,          -- app_store|play_store|stripe|promotional
  product_id  VARCHAR(191)    NULL,              -- ID im jeweiligen Store, nur zur Nachschau
  status      ENUM('active','grace','expired') NOT NULL DEFAULT 'active',
  expires_at  DATETIME        NULL,              -- NULL = laeuft ohne Ende (Vergabe/Promo)
  event_at    DATETIME        NULL,              -- Zeitstempel des Webhook-Ereignisses
  created_at  TIMESTAMP       NULL,
  updated_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  -- Eine Zeile pro Konto und Stufe: Ein zweiter Kauf derselben Stufe (neues
  -- Geraet, Wechsel des Stores) aktualisiert die bestehende Zeile, statt eine
  -- zweite anzulegen, die ihr widersprechen koennte.
  UNIQUE KEY subscriptions_user_entitlement_uq (user_id, entitlement),
  KEY subscriptions_active_idx (user_id, status, expires_at),
  CONSTRAINT subscriptions_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chat-Raeume. EIN Raum-Begriff fuer beide Anlaesse, an denen geredet wird:
-- eine Gruppe (`group_id`) oder ein Event (`activity_id`). Genau eine der beiden
-- Spalten ist gefuellt.
--
-- Warum der Raum eine eigene Zeile ist und nicht bloss ein Spaltenpaar an der
-- Nachricht: So haengt jede Nachricht per Fremdschluessel an ihrem Raum und der
-- Raum per Fremdschluessel an Gruppe bzw. Event. Wird eine Gruppe geloescht,
-- raeumt die Datenbank Raum und Nachrichten mit weg. Mit `room_type`/`room_id`
-- direkt an der Nachricht ginge das nicht – ein Fremdschluessel kann nicht auf
-- zwei Tabellen zeigen, und dann sammeln sich Nachrichten zu Gruppen an, die es
-- nicht mehr gibt.
--
-- Die eindeutigen Schluessel sorgen dafuer, dass es je Gruppe/Event hoechstens
-- EINEN Raum gibt (MySQL erlaubt beliebig viele NULL-Werte in einem UNIQUE, die
-- jeweils andere Spalte stoert also nicht).
CREATE TABLE IF NOT EXISTS chat_rooms (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(10)     NOT NULL,             -- 'group' | 'activity'
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nachrichten. `body` darf leer sein, wenn ein Event geteilt wurde – dann ist
-- die Karte die Nachricht (siehe src/messaging.js).
--
-- `shared_title` ist ein Schnappschuss des geteilten Events, wie in
-- `activity_history`: Wird das Event geloescht, loest der Fremdschluessel nur
-- `shared_activity_id` (SET NULL). Ohne den Schnappschuss bliebe eine leere
-- Nachricht im Verlauf stehen, bei der niemand mehr weiss, worum es ging.
CREATE TABLE IF NOT EXISTS chat_messages (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id            BIGINT UNSIGNED NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  body               VARCHAR(1000)   NOT NULL DEFAULT '',
  shared_activity_id BIGINT UNSIGNED NULL,
  shared_title       VARCHAR(255)    NULL,
  created_at         TIMESTAMP       NULL,
  -- An offer shared into a group chat (the same marketplace migration as invite_code).
  shared_offer_id    BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  -- (room_id, id): genau die Reihenfolge, in der der Verlauf gelesen wird.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bis wohin jemand einen Raum gelesen hat. Eine Zeile pro Person und Raum;
-- `last_read_id` ist die hoechste gesehene Nachrichten-ID. Daraus faellt die
-- Zahl der ungelesenen Nachrichten als reines COUNT ab – ohne je Nachricht eine
-- Zeile „gelesen von" anzulegen, die bei 50 Leuten in einer Gruppe fuenfzigmal
-- pro Nachricht entstehen wuerde.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wer wen blockiert hat. EINE Richtung pro Zeile: „A blockiert B" ist etwas
-- anderes als „B blockiert A", und wer blockiert wurde, soll das nicht daran
-- merken, dass er selbst ploetzlich als blockierend gilt.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Meldungen von Inhalten und Konten. Der Meldeweg ist keine Bequemlichkeit,
-- sondern die Gegenseite zum Haftungsausschluss in den Nutzungsbedingungen: Eine
-- Plattform, die nur erklaert, nicht zu haften, aber keinen Weg anbietet, etwas
-- zu melden, hat nichts vorgesehen.
--
-- `target_id` traegt bewusst KEINEN Fremdschluessel: Gemeldet werden fuenf
-- verschiedene Dinge (Event, Nachricht, Konto, Beitrag, Story), und die Meldung
-- muss das Loeschen ihres Gegenstands ueberdauern – gerade der geloeschte Inhalt
-- ist der, um den es hinterher geht.
--   status: 'open' (liegt vor) | 'reviewed' (bearbeitet) | 'dismissed' (verworfen)
CREATE TABLE IF NOT EXISTS content_reports (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_id BIGINT UNSIGNED NULL,                 -- SET NULL: Meldung ueberdauert das Konto
  target_type VARCHAR(20)     NOT NULL,             -- activity|message|user|post|story|post_comment|activity_comment
  target_id   BIGINT UNSIGNED NOT NULL,
  reason      VARCHAR(30)     NOT NULL,             -- Schluessel aus src/reports.js
  note        VARCHAR(500)    NULL,                 -- freie Schilderung (freiwillig)
  status      ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  handled_by  BIGINT UNSIGNED NULL,
  handled_at  DATETIME        NULL,
  created_at  TIMESTAMP       NULL,
  -- Was gemeldet wurde, im Moment der Meldung (Text, Verfasser:in, Gruppe; keine E-Mail-Adressen):
  -- Der Inhalt kann gleich danach geloescht oder umbenannt sein (Laravel-Migration
  -- 2026_10_08_000100_add_snapshot_to_content_reports, App\Http\Controllers\SafetyController).
  snapshot    JSON            NULL,
  PRIMARY KEY (id),
  -- Dieselbe Person meldet dasselbe nur einmal – sonst waere die Liste im
  -- Admin-Panel mit einem Dauerdruck auf den Knopf zu fluten.
  UNIQUE KEY content_reports_once_uq (reporter_id, target_type, target_id),
  KEY content_reports_status_idx (status, created_at),
  KEY content_reports_target_idx (target_type, target_id),
  CONSTRAINT content_reports_reporter_fk
    FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT content_reports_admin_fk
    FOREIGN KEY (handled_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Merkliste: gemerkte Events. Bewusst getrennt von `activity_user` (Teilnahme) –
-- „ich schau mir das noch an" ist keine Zusage, und ein gemerktes Event darf
-- keinen Platz belegen.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gefaellt-mir an einem Event. Gleicher Aufbau wie `post_likes`: eine Zeile pro
-- Person und Event, damit die Zahl „wie vielen gefaellt das" bedeutet und nicht
-- „wie oft wurde geklickt". Unabhaengig von Teilnahme und Merkliste – man darf
-- ein Event moegen, ohne hinzugehen.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kommentare an einem Event. Gleicher Aufbau wie `post_comments`; der Index
-- (activity_id, id) traegt die Liste „aelteste zuerst" unter einem Event.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Social-Links auf der Profilseite (Instagram, TikTok, eigene Seite, ...).
-- Pro Person und Plattform genau einer – daher der eindeutige Schluessel;
-- zwei Instagram-Links waeren in der Anzeige nicht unterscheidbar. Gespeichert
-- werden ausschliesslich fertige http(s)-Adressen (server/src/social.js).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Folgen: EINSEITIG und damit etwas anderes als eine Freundschaft. Freundschaft
-- ist ein Vertrag zu zweit (anfragen, annehmen) und schaltet Gruppen und Chats
-- frei; Folgen ist eine Abo-Entscheidung, die nur die folgende Person trifft.
-- Deshalb eine Zeile je Richtung und keine Anfrage.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gefaellt-mir an einem Beitrag. Eine Zeile pro Person und Beitrag – damit ist
-- die Zahl "wie vielen gefaellt das" und nicht "wie oft wurde geklickt".
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kommentare an einem Beitrag.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Benachrichtigungen. `ref_id` hat bewusst KEINEN Fremdschluessel: Die Nachricht
-- "X hat eine Story veroeffentlicht" muss die Story ueberleben – sonst
-- verschwaende der Verlauf nach 24 Stunden rueckwirkend. Deshalb tragen
-- `title`/`body` den Text schon fertig; beim Antippen prueft die App, ob es das
-- Ziel noch gibt.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Merkzettel des Event-Imports (src/import/): welches Event einer Location-Seite
-- wurde zu welcher Aktivitaet.
--
-- Eigene Tabelle statt einer Spalte in `activities`: Die Zuordnung ist eine
-- Aussage ueber die HERKUNFT, nicht ueber das Event. So bleibt `activities`
-- genau die Tabelle, die die App kennt – nichts in der App muss vom Import wissen.
--
-- `activity_id` ist ON DELETE SET NULL und nicht CASCADE: Loescht ein Admin ein
-- importiertes Event, bleibt die Zeile mit activity_id NULL zurueck. Das ist das
-- Gedaechtnis dafuer, dass es weg soll – der naechste Import-Lauf legt es nicht
-- wieder an.
CREATE TABLE IF NOT EXISTS imported_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source       VARCHAR(64)     NOT NULL,           -- slug aus src/import/sources.js
  external_id  VARCHAR(255)    NOT NULL,           -- ID des Events in der Quelle
  activity_id  BIGINT UNSIGNED NULL,               -- NULL = vom Admin entfernt, nicht neu anlegen
  content_hash CHAR(8)         NOT NULL,           -- Fingerabdruck, entscheidet ueber UPDATE
  source_url   VARCHAR(512)    NULL,
  last_seen_at DATETIME        NULL,               -- zuletzt in der Quelle gesehen
  created_at   TIMESTAMP       NULL,
  updated_at   TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY imported_events_source_external_uq (source, external_id),
  KEY imported_events_activity_id_idx (activity_id),
  CONSTRAINT imported_events_activity_id_fk
    FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Marketplace (api/database/migrations, 2026_10_01 to 2026_10_06): payments, bookings, check-ins
-- and stamps, vouchers, credits and their expiry lots, feature switches, group polls, partner staff
-- and wishes, and the admins' test phase. Laravel's migrations create these on a fresh database;
-- each definition here is the one MySQL reports for them (scripts/schema-drift compares both).
-- ---------------------------------------------------------------------------

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_flags (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key`      VARCHAR(40) NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 0,
  value      VARCHAR(40) NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY feature_flags_key_unique (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_previews (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  `key`      VARCHAR(40) NOT NULL,
  enabled    TINYINT(1) NULL,
  value      VARCHAR(40) NULL,
  created_at TIMESTAMP NULL,
  updated_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY feature_previews_user_id_key_unique (user_id, `key`),
  CONSTRAINT feature_previews_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS testphase_claims (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  `key`      VARCHAR(60) NOT NULL,
  period     VARCHAR(20) NOT NULL,
  credits    INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY testphase_claims_user_id_key_period_unique (user_id, `key`, period),
  CONSTRAINT testphase_claims_user_id_foreign
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
