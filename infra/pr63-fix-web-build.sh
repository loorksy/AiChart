#!/usr/bin/env bash
set -euo pipefail
DEPLOY_COMMIT=ed8d529ed45fe32dcab27b0a5b5e853959f53f9f
RC="$(readlink -f /opt/aichart)"
echo "RC=$RC"
cd "$RC/web"
npm install
npm run build
cd "$RC"
pm2 delete aichart-web aichart-worker 2>/dev/null || true
GIT_COMMIT="$DEPLOY_COMMIT" pm2 start infra/pm2.ecosystem.config.cjs --only aichart-web,aichart-worker
pm2 save
sleep 10
curl -fsS http://127.0.0.1:3010/api/healthz
echo
curl -fsS http://127.0.0.1:8787/health
echo
pm2 list | grep aichart
