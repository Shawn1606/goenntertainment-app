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

# Konfiguration einmal zusammenfassen: spart bei jeder Anfrage das Einlesen von
# ~15 Konfigurationsdateien. Geht, weil der Code kein env() außerhalb von config/
# aufruft (dann würde der Cache diese Werte verschlucken).
php artisan config:cache
php artisan event:cache

# Schema-Änderungen einspielen. Laravel verwaltet das Schema allein (api/database/
# migrations); die erste Migration legt die Tabellen aus der Node-Zeit nur an,
# wenn es sie noch nicht gibt, und ergänzt sonst nur fehlende Spalten.
# Nur im Container mit RUN_MIGRATIONS=true (api), nicht im scheduler.
if [ "$RUN_MIGRATIONS" = "true" ]; then
  php artisan migrate --force
fi

exec "$@"
