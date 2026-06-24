#!/usr/bin/env bash
# Install /etc/cron.d/aichart from infra/aichart.cron + web/.env CRON_SECRET
set -euo pipefail

ROOT="${1:-/opt/aichart}"
ENV_FILE="$ROOT/web/.env"
CRON_SRC="$ROOT/infra/aichart.cron"
CRON_DST=/etc/cron.d/aichart

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
if [[ ! -f "$CRON_SRC" ]]; then
  echo "Missing $CRON_SRC" >&2
  exit 1
fi

CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
if [[ -z "$CRON_SECRET" ]]; then
  echo "CRON_SECRET empty in $ENV_FILE" >&2
  exit 1
fi

sed -e "s|YOUR_DOMAIN|aichart.lork.cloud|g" \
    -e "s|YOUR_CRON_SECRET|${CRON_SECRET}|g" \
  "$CRON_SRC" > "$CRON_DST"
chmod 644 "$CRON_DST"
echo "Installed $CRON_DST ($(wc -l < "$CRON_DST") lines)"
