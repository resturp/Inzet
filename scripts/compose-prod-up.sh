#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"

"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" up -d --build
"${COMPOSE[@]}" ps

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "Health check failed after ${HEALTH_TIMEOUT_SECONDS}s: $HEALTH_URL" >&2
    "${COMPOSE[@]}" ps >&2 || true
    "${COMPOSE[@]}" logs --tail=120 web db >&2 || true
    exit 1
  fi
  sleep 3
done

echo "Health check ok: $HEALTH_URL"
