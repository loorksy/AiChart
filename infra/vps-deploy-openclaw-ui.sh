#!/usr/bin/env bash
# One-shot deploy: copy /tmp/oc-deploy into /opt/aichart, build web, enable Control UI + nginx.
set -euo pipefail

DEPLOY="${DEPLOY:-/tmp/oc-deploy}"
AICHART="${AICHART:-/opt/aichart}"

mkdir -p "$AICHART/infra/nginx" "$AICHART/docs"
cp -f "$DEPLOY/vps-openclaw-control-ui.sh" "$AICHART/infra/"
cp -f "$DEPLOY/vps-nginx-openclaw.sh" "$AICHART/infra/"
cp -f "$DEPLOY/nginx/aichart-openclaw.conf" "$AICHART/infra/nginx/"
cp -f "$DEPLOY/OPENCLAW_UI_INTEGRATION.md" "$AICHART/docs/"
cp -f "$DEPLOY/README.md" "$AICHART/agent/README.md" 2>/dev/null || true

mkdir -p "$AICHART/web/src/app/api/admin/openclaw-console"
mkdir -p "$AICHART/web/src/app/agent/console"
mkdir -p "$AICHART/web/src/components/agent"
cp -rf "$DEPLOY/web/openclaw-console/"* "$AICHART/web/src/app/api/admin/openclaw-console/"
cp -rf "$DEPLOY/web/console/"* "$AICHART/web/src/app/agent/console/"
cp -f "$DEPLOY/web/OpenClawConsoleClient.tsx" "$AICHART/web/src/components/agent/"
cp -f "$DEPLOY/web/page.tsx" "$AICHART/web/src/app/agent/page.tsx"
cp -f "$DEPLOY/web/.env.example" "$AICHART/web/.env.example"

chmod +x "$AICHART/infra/vps-openclaw-control-ui.sh" "$AICHART/infra/vps-nginx-openclaw.sh"

echo "=== building web ==="
cd "$AICHART/web"
npm run build

echo "=== openclaw control ui config ==="
bash "$AICHART/infra/vps-openclaw-control-ui.sh"

echo "=== nginx openclaw proxy ==="
bash "$AICHART/infra/vps-nginx-openclaw.sh"

echo "=== pm2 restart web ==="
pm2 restart aichart-web --update-env

echo "=== smoke test ==="
curl -sI "https://aichart.lork.cloud/openclaw/" | head -5
echo "done"
