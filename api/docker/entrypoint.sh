#!/bin/sh
# Startet die Laravel-API im Container.
#
# Läuft bei JEDEM Start, bevor Apache hochkommt. Hier und nicht beim Bauen, weil
# die Umgebungsvariablen (Datenbank, APP_KEY, Mail) erst beim Start feststehen –
# ein beim Bauen erzeugter Konfigurations-Cache hätte die falschen Werte.
set -e

cd /var/www/api

# The key is generated on the host with openssl, the same command as in deploy/README.md
# (Settings) and deploy/.env.example: a `docker compose run ... key:generate` cannot help here,
# because docker compose starts no service at all while APP_KEY is empty.
if [ -z "$APP_KEY" ]; then
  echo "ERROR: APP_KEY is missing. Generate it once, on the host:" >&2
  echo '  echo "base64:$(openssl rand -base64 32)"' >&2
  echo "Put the result into deploy/.env as APP_KEY, keep a copy in a password manager and never change it (deploy/README.md, Settings)." >&2
  exit 1
fi

# Required settings for the way to Node. Names only, never values (some are secrets).
missing=""
if [ -n "$NODE_FALLBACK_URL" ] && [ "${#NODE_INTERNAL_SECRET}" -lt 32 ]; then
  missing="$missing NODE_INTERNAL_SECRET(at least 32 characters)"
fi
# The reverse proxy's address (the compose sets it from APP_NET_PREFIX). Without it Laravel would
# see every client as the proxy; '*' would let every client choose its own address (F-31).
case "$TRUSTED_PROXIES" in
  ''|'*'|'**') missing="$missing TRUSTED_PROXIES(the reverse proxy's address, never *)" ;;
esac
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
