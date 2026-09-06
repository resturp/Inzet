#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if (( $# > 0 )); then
  echo "Set POSTGRES_PASSWORD in .env first, then run this script without arguments." >&2
  exit 1
fi

COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml")
"${COMPOSE[@]}" config -q

echo "Stopping web and db containers..."
"${COMPOSE[@]}" stop web db

echo "Repairing PostgreSQL login using the configured POSTGRES_PASSWORD..."
# Let Compose parse .env, exactly as it does for normal startup. Do not source
# dotenv as shell code, rotate passwords implicitly, or grant SUPERUSER rights.
"${COMPOSE[@]}" run --rm --no-deps --user postgres --entrypoint bash db /opt/inzet/postgres/repair-login.sh

cat <<'EOF'

Database login repaired. The configured password is unchanged; no .env edits needed.
Start production again with: ./scripts/compose-prod-up.sh
EOF
