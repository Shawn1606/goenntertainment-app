#!/bin/sh
# Startet die Laravel-API im Container.
#
# Läuft bei JEDEM Start, bevor Apache hochkommt. Hier und nicht beim Bauen, weil
# die Umgebungsvariablen (Datenbank, APP_KEY, Mail) erst beim Start feststehen –
# ein beim Bauen erzeugter Konfigurations-Cache hätte die falschen Werte.
set -e

cd /var/www/api

if [ -z "$APP_KEY" ]; then
  echo "FEHLER: APP_KEY fehlt. Erzeugen mit:" >&2
  echo "  docker compose run --rm --no-deps api php artisan key:generate --show" >&2
  echo "und das Ergebnis in deploy/.env als APP_KEY eintragen." >&2
  exit 1
fi

# Required settings for the way to Node. Names only, never values (some are secrets).
missing=""
if [ -n "$NODE_FALLBACK_URL" ] && [ "${#NODE_INTERNAL_SECRET}" -lt 32 ]; then
  missing="$missing NODE_INTERNAL_SECRET(at least 32 characters)"
fi
if [ -n "$missing" ]; then
  echo "ERROR: required settings missing or invalid:$missing (see deploy/.env.example)" >&2
  exit 1
fi

# Konfiguration einmal zusammenfassen: spart bei jeder Anfrage das Einlesen von
# ~15 Konfigurationsdateien. Geht, weil der Code kein env() außerhalb von config/
# aufruft (dann würde der Cache diese Werte verschlucken).
php artisan config:cache
php artisan event:cache

# KEIN `php artisan migrate`: Das Datenbank-Schema gehört dem Node-Backend
# (server/schema.sql + ensureSchema beim Start). Laravels Standard-Migrationen
# würden versuchen, die Tabelle `users` ein zweites Mal anzulegen, und der Start
# bräche ab. Cache, Sitzungen und Warteschlange laufen deshalb ohne eigene
# Tabellen (siehe deploy/docker-compose.yml).

exec "$@"
