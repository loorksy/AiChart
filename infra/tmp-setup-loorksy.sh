#!/usr/bin/env bash
set -euo pipefail
EMAIL="loorksy@gmail.com"
PASS="ahmetlork0009"

cd /opt/aichart/web
HASH=$(node -e "const b=require('bcryptjs'); console.log(b.hashSync(process.argv[1],10));" "$PASS")

sudo -u postgres psql -d aichart -v hash="$HASH" -v email="$EMAIL" <<'SQL'
SELECT id, email, role, status, access_expires_at FROM users WHERE email = :'email';

INSERT INTO users (email, password_hash, role, status, access_expires_at, username)
VALUES (
  :'email',
  :'hash',
  'admin',
  'active',
  NOW() + INTERVAL '365 days',
  'loorksy'
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = 'admin',
  status = 'active',
  access_expires_at = NOW() + INTERVAL '365 days',
  username = COALESCE(users.username, 'loorksy');

SELECT id, email, role, status, access_expires_at, username FROM users WHERE email = :'email';
SQL

MCP_SECRET=$(grep '^MCP_AUTH_SECRET=' /opt/aichart/web/.env | cut -d= -f2-)
echo ""
echo "MCP verify:"
curl -s -X POST http://127.0.0.1:3010/api/admin/mcp-auth/verify \
  -H "Content-Type: application/json" \
  -H "X-MCP-Auth-Secret: ${MCP_SECRET}" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}"
echo ""
