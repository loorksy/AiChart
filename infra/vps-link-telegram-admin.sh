#!/usr/bin/env bash
set -euo pipefail

TELEGRAM_ID="${1:-5969744996}"
WEB_DIR="${WEB_DIR:-/opt/aichart/web}"

cd "$WEB_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL missing in $WEB_DIR/.env" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v telegram_id="$TELEGRAM_ID" <<'SQL'
\pset tuples_only on
\pset format unaligned

SELECT '--- before ---';
SELECT id, email, role, telegram_id::text
FROM users
WHERE role = 'admin'
ORDER BY id ASC
LIMIT 1;

SELECT id, email, role, telegram_id::text
FROM users
WHERE telegram_id = :'telegram_id'::bigint;

-- free unique telegram_id if held by non-admin
UPDATE users
SET telegram_id = NULL
WHERE telegram_id = :'telegram_id'::bigint
  AND id NOT IN (
    SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1
  );

WITH admin AS (
  SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1
)
UPDATE users u
SET telegram_id = :'telegram_id'::bigint
FROM admin a
WHERE u.id = a.id;

WITH admin AS (
  SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1
)
INSERT INTO trading_settings (user_id, telegram_chat_id, updated_at)
SELECT a.id, :'telegram_id', NOW()
FROM admin a
ON CONFLICT (user_id) DO UPDATE
SET telegram_chat_id = EXCLUDED.telegram_chat_id,
    updated_at = NOW();

SELECT '--- after ---';
SELECT u.id, u.email, u.role, u.telegram_id::text, ts.telegram_chat_id
FROM users u
LEFT JOIN trading_settings ts ON ts.user_id = u.id
WHERE u.role = 'admin'
ORDER BY u.id ASC
LIMIT 1;
SQL

echo "Done: linked telegram_id=$TELEGRAM_ID to admin."
