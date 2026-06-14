#!/usr/bin/env bash
set -euo pipefail
PORT=3010
WEB=/opt/aichart/web

cat > /opt/aichart/infra/pm2.aichart.cjs <<EOF
module.exports = {
  apps: [
    {
      name: "aichart-web",
      cwd: "${WEB}",
      script: "npm",
      args: "start",
      instances: 1,
      autorestart: true,
      max_memory_restart: "768M",
      env: { NODE_ENV: "production", PORT: ${PORT} },
    },
  ],
};
EOF

pm2 delete aichart-web pm2.aichart 2>/dev/null || true
cd "$WEB"
PORT=${PORT} NODE_ENV=production pm2 start npm --name aichart-web --cwd "$WEB" --update-env -- start
pm2 save
sleep 5
curl -fsS -o /dev/null -w "local: %{http_code}\n" "http://127.0.0.1:${PORT}/"
curl -fsS -o /dev/null -w "HTTPS: %{http_code}\n" "https://aichart.lork.cloud/" || true
pm2 list | grep aichart

set -a
source /opt/aichart/web/.env
set +a
export AICHART_API_URL="http://127.0.0.1:${PORT}"
bash /opt/aichart/agent/scripts/sync-model.sh || true
pm2 restart aichart-agent --update-env
sleep 4
pm2 list | grep aichart
