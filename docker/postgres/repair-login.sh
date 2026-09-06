#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${PGDATA:?PGDATA must be set}"
if [[ ! -s "$PGDATA/PG_VERSION" || -e "$PGDATA/postmaster.pid" ]]; then
  echo "Repair requires an existing, stopped PostgreSQL database." >&2
  exit 1
fi

# Single-user mode also works when the role has NOLOGIN. Quote both SQL values
# and reject newlines, since single-user mode treats each line as a statement.
if [[ "$POSTGRES_USER$POSTGRES_PASSWORD" == *$'\n'* || "$POSTGRES_USER$POSTGRES_PASSWORD" == *$'\r'* ]]; then
  echo "Login repair does not support newlines in database credentials." >&2
  exit 1
fi
role="${POSTGRES_USER//\"/\"\"}"
password="${POSTGRES_PASSWORD//\'/\'\'}"
repair_log="$(mktemp)"
trap 'rm -f "$repair_log"' EXIT

# postgres --single can return zero after an SQL error. Check its output as well,
# without printing SQL or credentials from recovery diagnostics.
if ! printf 'ALTER ROLE "%s" WITH LOGIN PASSWORD '\''%s'\'';\n' "$role" "$password" \
  | postgres --single -D "$PGDATA" -c standard_conforming_strings=on \
      -c log_statement=none -c log_min_error_statement=panic template1 >"$repair_log" 2>&1 \
  || grep -Eq '(ERROR|FATAL|PANIC):' "$repair_log"; then
  echo "Login repair failed. Check POSTGRES_USER, the volume and PostgreSQL configuration." >&2
  exit 1
fi
