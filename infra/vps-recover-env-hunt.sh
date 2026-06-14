#!/usr/bin/env bash
grep -h DATABASE_URL /root/.pm2/logs/aichart-web-out.log /root/.pm2/logs/aichart-web-error.log 2>/dev/null | head -3
grep -h ENCRYPTION_KEY /root/.pm2/logs/aichart-web-out.log 2>/dev/null | head -3
sudo -u postgres psql aichart -t -c "SELECT key, plain, left(value,20) FROM platform_config WHERE key IN ('ENCRYPTION_KEY','APP_SECRET');"
sudo -u postgres psql aichart -t -c "SELECT email, role FROM users;"
# try peer connection string
echo "DATABASE_URL=postgresql://aichart@127.0.0.1:5432/aichart (password unknown)"
