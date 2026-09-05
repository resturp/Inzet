#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

DB_NAME="${POSTGRES_DB:-inzet}"
DB_USER="${POSTGRES_USER:-postgres}"
NEW_PASSWORD="${1:-$(openssl rand -hex 24)}"

if [[ ! "$NEW_PASSWORD" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  echo "Password may only contain letters, numbers, underscore, dot, at-sign and dash." >&2
  exit 1
fi

COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml")

echo "Stopping web and db containers..."
"${COMPOSE[@]}" stop web db

echo "Repairing PostgreSQL role '$DB_USER' in existing volume..."
printf "ALTER ROLE %s WITH LOGIN SUPERUSER PASSWORD '%s';\n" "$DB_USER" "$NEW_PASSWORD" \
  | "${COMPOSE[@]}" run --rm --no-deps --user postgres db postgres --single -D /var/lib/postgresql/data template1

cat <<EOF

Database login repaired.

Put these values in .env on the server:

POSTGRES_DB="$DB_NAME"
POSTGRES_USER="$DB_USER"
POSTGRES_PASSWORD="$NEW_PASSWORD"
DOCKER_DATABASE_URL="postgresql://$DB_USER:$NEW_PASSWORD@db:5432/$DB_NAME?schema=public"
NEXT_PUBLIC_APP_URL="https://vczwolle.frii.nl"

Then run:

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
curl -i http://127.0.0.1:3000/api/health
EOF
