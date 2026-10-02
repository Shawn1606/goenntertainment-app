#!/usr/bin/env bash
# The one-shot `admin-gate` service (deploy/docker-compose.yml): keeps caddy, the public edge,
# down until an admin account exists (F-05). caddy starts only after this service completed
# successfully, so on a first start the domain stays unreachable until the admin was created
# with the one-off `seed` service (deploy/README.md). It runs on every `docker compose up`. A host
# reboot restarts caddy through its restart policy without the gate; the gate is about the first
# start.
#
# Exit 0: at least one admin account exists. Exit 1: none, or the database cannot be asked.
# The password reaches the mysql client through an option file in /tmp (a tmpfs), written by
# the shell's builtin printf: it is on no command line and in no log.
set -Eeuo pipefail
umask 077

readonly CLIENT_CNF=/tmp/admin-gate-client.cnf
trap 'rm -f "$CLIENT_CNF"' EXIT

missing=()
for name in DB_HOST DB_DATABASE DB_USERNAME DB_PASSWORD; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if (( ${#missing[@]} > 0 )); then
  echo "admin-gate: missing settings: ${missing[*]}; caddy stays down." >&2
  exit 1
fi

# Quoted values, with backslash and double quote escaped, so any password works.
password=${DB_PASSWORD//\\/\\\\}
password=${password//\"/\\\"}
printf '[client]\nhost="%s"\nport="%s"\nuser="%s"\npassword="%s"\n' \
  "$DB_HOST" "${DB_PORT:-3306}" "$DB_USERNAME" "$password" > "$CLIENT_CNF"

if ! admins=$(mysql --defaults-extra-file="$CLIENT_CNF" --batch --skip-column-names \
  --execute='SELECT COUNT(*) FROM users WHERE is_admin = 1' "$DB_DATABASE"); then
  echo 'admin-gate: cannot count the admin accounts (see docker compose logs db); caddy stays down.' >&2
  exit 1
fi

if [[ "$admins" =~ ^[0-9]+$ ]] && (( admins >= 1 )); then
  echo "admin-gate: $admins admin account(s); caddy may start."
  exit 0
fi

echo 'admin-gate: no admin account yet. Create it first with the one-off seed service (deploy/README.md, first start), then run docker compose up -d again; caddy stays down.' >&2
exit 1
