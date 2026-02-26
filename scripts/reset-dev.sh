#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" && -f ".env.example" ]]; then
  cp .env.example .env
fi

docker compose down -v --remove-orphans

rm -rf .next

docker compose up -d --build

echo ""
echo "Schone dev-installatie gestart."
echo "Web: http://localhost:3000"
echo "Database: localhost:5432"
echo ""
echo "Tip: relatiecodes komen uit data/relatiecodes.csv (geen losse JSON-allowlist meer)."
