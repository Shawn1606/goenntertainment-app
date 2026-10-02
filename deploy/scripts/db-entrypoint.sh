#!/usr/bin/env bash
# Entrypoint of the `db` service (deploy/docker-compose.yml): checks the binary-log retention,
# then hands over to the MySQL image's own entrypoint.
#
# MySQL keeps a binary log of every change (including the rows of deleted accounts). Its own
# default keeps it for 30 days, and 0 would keep it forever. How long it is kept is a retention
# decision (F-45), so it is a required setting without a default:
#
#   MYSQL_BINLOG_RETENTION_DAYS=<1..9999>   keep the binary log this many days
#   MYSQL_BINLOG_RETENTION_DAYS=off         no binary log at all (no point-in-time restore)
#
# Anything else stops the start with exit code 2 and a message that names the setting (never a
# value of another setting).
#
#   db-entrypoint.sh mysqld [options]                  validate, then start MySQL
#   db-entrypoint.sh --print-command mysqld [options]  validate, print the command, start nothing
set -Eeuo pipefail

# The accepted values. Named mirror: deploy/scripts/preflight.sh checks the same pattern
# (deploy/test/static.test.mjs compares both).
BINLOG_RETENTION_PATTERN='^([1-9][0-9]{0,3}|off)$'

print_only=0
if [[ "${1:-}" == '--print-command' ]]; then
  print_only=1
  shift
fi

days="${MYSQL_BINLOG_RETENTION_DAYS:-}"
if [[ ! "$days" =~ $BINLOG_RETENTION_PATTERN ]]; then
  echo "db: MYSQL_BINLOG_RETENTION_DAYS must be a whole number of days from 1 to 9999, or off (see deploy/.env.example); MySQL was not started." >&2
  exit 2
fi

if [[ "$days" == 'off' ]]; then
  binlog=('--disable-log-bin')
else
  binlog=("--binlog-expire-logs-seconds=$((days * 86400))")
fi

if [[ "$print_only" == 1 ]]; then
  printf '%s\n' "docker-entrypoint.sh $* ${binlog[*]}"
  exit 0
fi

exec docker-entrypoint.sh "$@" "${binlog[@]}"
