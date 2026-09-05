#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")

git pull --ff-only
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" up -d --build
"${COMPOSE[@]}" ps
