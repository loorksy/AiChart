#!/usr/bin/env bash
# One-time PostgreSQL setup for AiChart on VPS.
# Run as root on 72.60.83.140 from /opt/aichart/web

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/aichart}"
WEB_DIR="$APP_DIR/web"
DB_NAME="${DB_NAME:-aichart}"
DB_USER="${DB_USER:-aichart}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"

echo "==> Installing PostgreSQL (if needed)"
if ! command -v psql >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
fi

echo "==> Creating database user and database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

echo "==> Updating .env"
ENV_FILE="$WEB_DIR/.env"
touch "$ENV_FILE"
grep -q '^DATABASE_URL=' "$ENV_FILE" && sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$ENV_FILE" || echo "DATABASE_URL=${DATABASE_URL}" >> "$ENV_FILE"
grep -q '^ADMIN_EMAIL=' "$ENV_FILE" && sed -i 's|^ADMIN_EMAIL=.*|ADMIN_EMAIL=loorksy@gmail.com|' "$ENV_FILE" || echo "ADMIN_EMAIL=loorksy@gmail.com" >> "$ENV_FILE"

cd "$WEB_DIR"
echo "==> npm install"
npm install --omit=dev 2>/dev/null || npm install

echo "==> Building app (initializes PG schema on first request; run migration now)"
export DATABASE_URL ADMIN_EMAIL=loorksy@gmail.com
node scripts/migrate-sqlite-to-pg.mjs

echo "==> Rebuild production"
npm run build

echo "==> Restart PM2"
cd "$WEB_DIR"
PORT=3010 pm2 restart aichart-web --update-env || PORT=3010 pm2 start npm --name aichart-web -- start

echo ""
echo "PostgreSQL ready."
echo "DATABASE_URL=${DATABASE_URL}"
echo "ADMIN_EMAIL=loorksy@gmail.com"
