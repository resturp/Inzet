#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SOURCE="$ROOT_DIR/deploy/systemd/inzet.service"
UNIT_TARGET="/etc/systemd/system/inzet.service"

if [[ ! -f "$UNIT_SOURCE" ]]; then
  echo "Unit template not found: $UNIT_SOURCE" >&2
  exit 1
fi

tmp_unit="$(mktemp)"
trap 'rm -f "$tmp_unit"' EXIT

sed "s#__INZET_ROOT__#$ROOT_DIR#g" "$UNIT_SOURCE" > "$tmp_unit"

sudo install -m 0644 "$tmp_unit" "$UNIT_TARGET"
sudo systemctl daemon-reload
sudo systemctl enable --now inzet
sudo systemctl status inzet --no-pager -l
