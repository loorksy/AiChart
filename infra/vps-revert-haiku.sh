#!/usr/bin/env bash
# Revert OpenClaw + platform to Haiku (was overwritten to Sonnet by sync-model on deploy).
set -euo pipefail

HAIKU="claude-haiku-4-5-20251001"
ENV_FILE="/opt/aichart/web/.env"

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

echo "=== before ==="
curl -sS -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "${AICHART_API_URL:-http://127.0.0.1:3010}/api/agent/model" || true
echo ""

psql "$DATABASE_URL" -c \
  "INSERT INTO platform_config (key, value, plain, updated_at)
   VALUES ('ANTHROPIC_MODEL', '$HAIKU', TRUE, NOW())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, plain = TRUE, updated_at = NOW();"

echo "=== platform updated to $HAIKU ==="

export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export OPENCLAW_AUTO_RESTART=1
bash /opt/aichart/agent/scripts/sync-model.sh

pm2 restart aichart-web --update-env
sleep 2

echo "=== after ==="
curl -sS -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" \
  "$AICHART_API_URL/api/agent/model"
echo ""
node -pe "require('/root/.openclaw/openclaw.json').agents?.defaults?.model?.primary"
