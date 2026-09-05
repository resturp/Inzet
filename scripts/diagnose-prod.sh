#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1
COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")

echo "== Inzet production diagnostics =="
echo "Directory: $ROOT_DIR"
echo

echo "== Git =="
git rev-parse --show-toplevel 2>/dev/null || true
git status --short 2>/dev/null || true
echo

echo "== Systemd =="
systemctl is-active inzet 2>/dev/null || true
systemctl status inzet --no-pager -l 2>/dev/null || true
echo

echo "== Docker Compose config =="
"${COMPOSE[@]}" config -q
echo "config: ok"
echo

echo "== Host listening ports =="
ss -ltnp 2>/dev/null | grep -E ':(80|443|3000)\b' || true
echo

echo "== Containers =="
"${COMPOSE[@]}" ps
echo

echo "== Internal DNS and ports =="
"${COMPOSE[@]}" exec -T web sh -lc 'getent hosts db; getent hosts mail; nc -vz db 5432; nc -vz mail 25'
echo

echo "== App health =="
curl -i --max-time 10 http://127.0.0.1:3000/api/health || true
echo
"${COMPOSE[@]}" exec -T web node -e "fetch('http://localhost:3000/api/health').then(async (response) => { console.log(response.status, await response.text()); }).catch((error) => { console.error(error); process.exit(1); });"
echo

echo "== Recent web logs =="
"${COMPOSE[@]}" logs --tail=80 web
echo

echo "== Recent mail logs =="
"${COMPOSE[@]}" logs --tail=80 mail
echo

echo "== Mail queue =="
"${COMPOSE[@]}" exec -T mail postqueue -p || true
echo

echo "== Mail DNS from container =="
"${COMPOSE[@]}" exec -T mail sh -lc 'getent hosts gmail-smtp-in.l.google.com; getent hosts mail.frii.nl' || true
