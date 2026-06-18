#!/usr/bin/env bash
# Complete multi-user EA readiness: env fix, verify DB index, run all tests, optional PM2 scale.
set -euo pipefail
cd /opt/aichart

ENV_FILE=web/.env

echo "==> Env fixes"
grep -q '^FOREX_BACKEND=' "$ENV_FILE" || echo 'FOREX_BACKEND=ea' >> "$ENV_FILE"
grep -q '^FOREX_BACKEND=' "$ENV_FILE" && sed -i 's/^FOREX_BACKEND=.*/FOREX_BACKEND=ea/' "$ENV_FILE" || true
echo "FOREX_BACKEND=$(grep '^FOREX_BACKEND=' "$ENV_FILE" | cut -d= -f2-)"
echo "SINGLE_USER=$(grep '^AICHART_SINGLE_USER=' "$ENV_FILE" | cut -d= -f2-)"
echo "REDIS_URL set=$(grep -c '^REDIS_URL=' "$ENV_FILE" || true)"

echo "==> Trigger DB migration (web init)"
pm2 restart aichart-web --update-env
sleep 6

echo "==> ea_connections indexes"
sudo -u postgres psql -d aichart -c "SELECT indexname FROM pg_indexes WHERE tablename = 'ea_connections' ORDER BY 1;"

echo "==> Bridge isolation"
bash infra/tmp-vps-bridge-test.sh

echo "==> EA isolation"
bash infra/tmp-vps-ea-isolation-test.sh

echo "==> Smoke"
python3 infra/tmp-vps-smoke-all.py || SMOKE=$?
SMOKE=${SMOKE:-0}

echo "==> PM2 Redis scale test (2 instances)"
pm2 scale aichart-web 2 2>/dev/null || true
sleep 5
curl -sf -o /dev/null -w "web x2 %{http_code}\n" http://127.0.0.1:3010/ || echo "web x2 failed"
# Restore single instance on PORT 3010 (nginx upstream)
bash /opt/aichart/infra/vps-fix-web-port.sh 2>/dev/null || {
  pm2 delete aichart-web 2>/dev/null || true
  cd /opt/aichart/web
  PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web -- update-env -- start
  pm2 save
}
sleep 3
curl -sf -o /dev/null -w "web x1 %{http_code}\n" http://127.0.0.1:3010/ || echo "web x1 failed"
echo "PM2 scale test done (restored via vps-fix-web-port)"

echo "==> Finish summary"
pm2 list | grep aichart || true
exit "$SMOKE"
