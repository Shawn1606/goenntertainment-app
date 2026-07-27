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
  account_type      VARCHAR(255)    NULL,
  google_id         VARCHAR(255)    NULL,
  avatar            VARCHAR(255)    NULL,
  email             VARCHAR(255)    NOT NULL,
  email_verified_at TIMESTAMP       NULL,
  password          VARCHAR(255)    NULL,          -- nullable: reine Google-Konten
  is_admin          TINYINT(1)      NOT NULL DEFAULT 0, -- 1 = Admin (darf jedes Event loeschen, sieht Admin-Tab)
  remember_token    VARCHAR(100)    NULL,
  created_at        TIMESTAMP       NULL,
  updated_at        TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email),
  UNIQUE KEY users_username_unique (username),
  UNIQUE KEY users_google_id_unique (google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Passwort-Zuruecksetzen (E-Mail -> Token)
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
