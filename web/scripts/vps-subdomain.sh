#!/bin/bash
set -e
sed -i 's|^APP_URL=.*|APP_URL=https://aichart.lork.cloud|' /opt/aichart/web/.env || true
grep APP_URL /opt/aichart/web/.env
pm2 reload aichart-web --update-env
curl -s -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/
DB=/opt/aichart/web/data/aichart.db
echo "--- tables ---"
sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;"
echo "--- users ---"
sqlite3 "$DB" "SELECT id,email,role,status FROM users;"
echo "--- counts ---"
sqlite3 "$DB" "SELECT 'conversations', COUNT(*) FROM conversations UNION ALL SELECT 'chat_messages', COUNT(*) FROM chat_messages UNION ALL SELECT 'recommendations', COUNT(*) FROM recommendations;"
echo "--- api login test ---"
CODE=$(curl -s -o /tmp/aichart-login.json -w "%{http_code}" -X POST https://aichart.lork.cloud/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@aichart.local","password":"change-this-password-now"}')
echo "login HTTP $CODE"
cat /tmp/aichart-login.json
