import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../constants";
import { adaptSql, normalizeRow } from "./sql";
import type { DbRow, ExecuteResult } from "./types";

let _pool: Pool | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'pending',
    telegram_id   BIGINT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS binance_accounts (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    api_key_enc    TEXT NOT NULL,
    api_secret_enc TEXT NOT NULL,
    env            TEXT NOT NULL DEFAULT 'testnet',
    label          TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS trading_settings (
    user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode                     TEXT NOT NULL DEFAULT 'approval',
    approval                 TEXT NOT NULL DEFAULT 'manual',
    experience               TEXT NOT NULL DEFAULT 'beginner',
    style                    TEXT NOT NULL DEFAULT 'conservative',
    max_capital              DOUBLE PRECISION NOT NULL DEFAULT 0,
    per_trade_pct            DOUBLE PRECISION NOT NULL DEFAULT 10,
    max_open_trades          INTEGER NOT NULL DEFAULT 1,
    daily_profit_target_pct  DOUBLE PRECISION NOT NULL DEFAULT 3,
    daily_profit_target_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
    daily_loss_limit_pct     DOUBLE PRECISION NOT NULL DEFAULT 5,
    monthly_loss_limit_pct   DOUBLE PRECISION NOT NULL DEFAULT 15,
    auto_take_profit_usd     DOUBLE PRECISION NOT NULL DEFAULT 0,
    allowed_assets           TEXT NOT NULL DEFAULT '[]',
    active_market            TEXT NOT NULL DEFAULT 'crypto',
    send_screenshot          BOOLEAN NOT NULL DEFAULT TRUE,
    telegram_chat_id         TEXT,
    kill_switch              BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_done          BOOLEAN NOT NULL DEFAULT FALSE,
    alerts_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    alert_trades             BOOLEAN NOT NULL DEFAULT TRUE,
    alert_signals            BOOLEAN NOT NULL DEFAULT TRUE,
    alert_min_confidence     INTEGER NOT NULL DEFAULT 0,
    min_confidence           INTEGER NOT NULL DEFAULT 80,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS admin_limits (
    user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    can_execute         BOOLEAN NOT NULL DEFAULT FALSE,
    max_capital_cap     DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_open_trades_cap INTEGER NOT NULL DEFAULT 1,
    claude_quota        INTEGER NOT NULL DEFAULT 1000,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    action          TEXT NOT NULL,
    confidence      INTEGER NOT NULL DEFAULT 0,
    entry           DOUBLE PRECISION,
    stop_loss       DOUBLE PRECISION,
    take_profit     DOUBLE PRECISION,
    timeframe       TEXT,
    rationale       TEXT,
    factors         TEXT,
    chart_image_url TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS claude_usage (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  CREATE TABLE IF NOT EXISTS trade_intents (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recommendation_id INTEGER,
    symbol            TEXT NOT NULL,
    side              TEXT NOT NULL,
    notional          DOUBLE PRECISION NOT NULL,
    market            TEXT NOT NULL DEFAULT 'crypto',
    broker            TEXT NOT NULL DEFAULT 'binance',
    entry             DOUBLE PRECISION,
    stop_loss         DOUBLE PRECISION,
    take_profit       DOUBLE PRECISION,
    confidence        INTEGER NOT NULL DEFAULT 0,
    rationale         TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    reason            TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS trades (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    intent_id   INTEGER,
    symbol      TEXT NOT NULL,
    side        TEXT NOT NULL,
    qty         DOUBLE PRECISION NOT NULL DEFAULT 0,
    quote_qty   DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_price   DOUBLE PRECISION NOT NULL DEFAULT 0,
    order_id    TEXT,
    env         TEXT NOT NULL DEFAULT 'testnet',
    market      TEXT NOT NULL DEFAULT 'crypto',
    broker      TEXT NOT NULL DEFAULT 'binance',
    status      TEXT NOT NULL DEFAULT 'open',
    pnl         DOUBLE PRECISION NOT NULL DEFAULT 0,
    oco_order_list_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS ea_connections (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform          TEXT NOT NULL DEFAULT 'mt5',
    token_hash        TEXT NOT NULL,
    label             TEXT,
    broker_name       TEXT,
    account_login     TEXT,
    account_currency  TEXT,
    balance           DOUBLE PRECISION NOT NULL DEFAULT 0,
    equity            DOUBLE PRECISION NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'offline',
    symbol_specs_json TEXT,
    last_heartbeat_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ea_connections_user
    ON ea_connections (user_id);
  CREATE INDEX IF NOT EXISTS idx_ea_connections_token
    ON ea_connections (token_hash);

  CREATE TABLE IF NOT EXISTS ea_commands (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    intent_id     INTEGER,
    command_type  TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    result_json   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_ea_commands_poll
    ON ea_commands (user_id, status, id);

  CREATE TABLE IF NOT EXISTS ea_market_cache (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol       TEXT NOT NULL,
    interval     TEXT NOT NULL,
    candles_json TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, symbol, interval)
  );

  CREATE TABLE IF NOT EXISTS mt_accounts (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform            TEXT NOT NULL DEFAULT 'mt5',
    server              TEXT NOT NULL,
    login               TEXT NOT NULL,
    password_enc        TEXT NOT NULL,
    metaapi_account_id  TEXT NOT NULL,
    region              TEXT,
    state               TEXT NOT NULL DEFAULT 'CREATED',
    connection_status   TEXT,
    balance             DOUBLE PRECISION NOT NULL DEFAULT 0,
    equity              DOUBLE PRECISION NOT NULL DEFAULT 0,
    currency            TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_mt_accounts_user
    ON mt_accounts (user_id);

  CREATE TABLE IF NOT EXISTS system_flags (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
    client_id   TEXT PRIMARY KEY,
    client_json TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
    token_hash  TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    email       TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_mcp_refresh_client
    ON mcp_oauth_refresh_tokens (client_id, revoked);

  CREATE TABLE IF NOT EXISTS platform_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    plain      BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'محادثة جديدة',
    summary    TEXT,
    archived   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    metadata_json   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations (user_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_chat_messages_conv
    ON chat_messages (conversation_id, id);

  CREATE INDEX IF NOT EXISTS idx_settings_tg
    ON trading_settings (telegram_chat_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS scan_cooldowns (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol     TEXT NOT NULL,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS alert_log (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    symbol     TEXT,
    delivered  BOOLEAN NOT NULL DEFAULT FALSE,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_alert_log_user
    ON alert_log (user_id, id DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id
    ON users (telegram_id) WHERE telegram_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS trade_lessons (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trade_id            INTEGER NOT NULL,
    recommendation_id   INTEGER,
    symbol              TEXT NOT NULL,
    market              TEXT NOT NULL DEFAULT 'crypto',
    timeframe           TEXT,
    pattern_name        TEXT,
    outcome             TEXT NOT NULL,
    pnl                 DOUBLE PRECISION NOT NULL DEFAULT 0,
    pnl_pct             DOUBLE PRECISION NOT NULL DEFAULT 0,
    entry_context_json  TEXT,
    lesson_ar           TEXT NOT NULL,
    tags_json           TEXT,
    embedding           vector(1536),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_trade_lessons_user
    ON trade_lessons (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trade_lessons_symbol
    ON trade_lessons (user_id, symbol);
`;

async function migratePg(client: PoolClient) {
  await client.query(`CREATE EXTENSION IF NOT EXISTS vector`).catch((err) => {
    console.warn("[db] pgvector extension unavailable:", err);
  });

  await client.query(`
    UPDATE platform_config SET plain = TRUE
    WHERE plain = FALSE
      AND key IN (
        'ANTHROPIC_MODEL',
        'TELEGRAM_BOT_USERNAME',
        'APP_URL',
        'ENABLE_BINANCE_CLI',
        'METAAPI_REGION'
      )
  `).catch(() => {
    /* table may be empty on first boot */
  });

  // Advanced alert preferences on trading_settings.
  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS alerts_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS alert_trades          BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS alert_signals         BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS alert_min_confidence  INTEGER NOT NULL DEFAULT 0
  `).catch(() => {
    /* table may not exist yet on first boot */
  });

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS daily_profit_target_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS auto_take_profit_usd    DOUBLE PRECISION NOT NULL DEFAULT 0
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS active_market TEXT NOT NULL DEFAULT 'crypto'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS oco_order_list_id TEXT
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'crypto',
      ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT 'binance'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trade_intents
      ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'crypto',
      ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT 'binance'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'spot',
      ADD COLUMN IF NOT EXISTS leverage DOUBLE PRECISION NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'market'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trade_intents
      ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'spot',
      ADD COLUMN IF NOT EXISTS leverage DOUBLE PRECISION NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'market',
      ADD COLUMN IF NOT EXISTS limit_price DOUBLE PRECISION
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS limit_price DOUBLE PRECISION
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS futures_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS default_leverage DOUBLE PRECISION NOT NULL DEFAULT 3
  `).catch(() => {});

  await client.query(`
    ALTER TABLE admin_limits
      ADD COLUMN IF NOT EXISTS max_leverage_cap DOUBLE PRECISION NOT NULL DEFAULT 10
  `).catch(() => {});

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ
  `).catch(() => {});

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT
  `).catch(() => {});
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
      ON users (username) WHERE username IS NOT NULL
  `).catch(() => {});

  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_e164 TEXT
  `).catch(() => {});
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp
      ON users (whatsapp_e164) WHERE whatsapp_e164 IS NOT NULL
  `).catch(() => {});

  await client.query(`
    ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS image_url TEXT
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS last_manual_scan_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scan_poll_minutes INTEGER NOT NULL DEFAULT 0
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS analysis_interval TEXT NOT NULL DEFAULT '1h'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE recommendations
      ADD COLUMN IF NOT EXISTS chart_drawings_json TEXT,
      ADD COLUMN IF NOT EXISTS pattern_name TEXT,
      ADD COLUMN IF NOT EXISTS analysis_tier TEXT,
      ADD COLUMN IF NOT EXISTS context_json TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web',
      ADD COLUMN IF NOT EXISTS market TEXT
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS telegram_pending (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      intent_id  INTEGER NOT NULL,
      step       TEXT NOT NULL,
      message_id INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS mt_accounts (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform            TEXT NOT NULL DEFAULT 'mt5',
      server              TEXT NOT NULL,
      login               TEXT NOT NULL,
      password_enc        TEXT NOT NULL,
      metaapi_account_id  TEXT NOT NULL,
      region              TEXT,
      state               TEXT NOT NULL DEFAULT 'CREATED',
      connection_status   TEXT,
      balance             DOUBLE PRECISION NOT NULL DEFAULT 0,
      equity              DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency            TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mt_accounts_user
      ON mt_accounts (user_id)
  `).catch(() => {});

  await client.query(`
    ALTER TABLE recommendations
      ADD COLUMN IF NOT EXISTS committee_json TEXT,
      ADD COLUMN IF NOT EXISTS memory_refs_json TEXT
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS execution_env_preference TEXT NOT NULL DEFAULT 'demo'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS min_confidence INTEGER NOT NULL DEFAULT 80
  `).catch(() => {});

  await client.query(`
    UPDATE trading_settings SET min_confidence = 80
    WHERE min_confidence IS NULL
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trade_intents
      ADD COLUMN IF NOT EXISTS practice BOOLEAN NOT NULL DEFAULT FALSE
  `).catch(() => {});

  await client.query(`
    ALTER TABLE ea_connections
      ADD COLUMN IF NOT EXISTS account_trade_mode TEXT,
      ADD COLUMN IF NOT EXISTS positions_json TEXT
  `).catch(() => {});

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'binance_accounts_pkey'
          AND conrelid = 'binance_accounts'::regclass
          AND pg_get_constraintdef(oid) LIKE '%user_id, env%'
      ) THEN
        ALTER TABLE binance_accounts DROP CONSTRAINT IF EXISTS binance_accounts_pkey;
        ALTER TABLE binance_accounts ADD PRIMARY KEY (user_id, env);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS trade_lessons (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_id            INTEGER NOT NULL,
      recommendation_id   INTEGER,
      symbol              TEXT NOT NULL,
      market              TEXT NOT NULL DEFAULT 'crypto',
      timeframe           TEXT,
      pattern_name        TEXT,
      outcome             TEXT NOT NULL,
      pnl                 DOUBLE PRECISION NOT NULL DEFAULT 0,
      pnl_pct             DOUBLE PRECISION NOT NULL DEFAULT 0,
      entry_context_json  TEXT,
      lesson_ar           TEXT NOT NULL,
      tags_json           TEXT,
      embedding           vector(1536),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_trade_lessons_user
      ON trade_lessons (user_id, created_at DESC)
  `).catch(() => {});

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_trade_lessons_symbol
      ON trade_lessons (user_id, symbol)
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key         TEXT NOT NULL,
      result_json TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, key)
    )
  `).catch(() => {});

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
      ON idempotency_keys (expires_at)
  `).catch(() => {});
}

async function seedAdminPg(client: PoolClient) {
  const adminEmail = ADMIN_EMAIL.toLowerCase();
  const existing = await client.query<{ id: number }>(
    "SELECT id FROM users WHERE email = $1",
    [adminEmail],
  );

  if (existing.rows[0]) {
    const userId = existing.rows[0].id;
    await client.query(
      "UPDATE users SET role = 'admin', status = 'active' WHERE id = $1",
      [userId],
    );
    await client.query(
      "INSERT INTO trading_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );
    await client.query(
      `INSERT INTO admin_limits (user_id, can_execute) VALUES ($1, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET can_execute = TRUE`,
      [userId],
    );
    return;
  }

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const inserted = await client.query<{ id: number }>(
    "INSERT INTO users (email, password_hash, role, status) VALUES ($1, $2, 'admin', 'active') RETURNING id",
    [adminEmail, hash],
  );
  const userId = inserted.rows[0]!.id;
  await client.query("INSERT INTO trading_settings (user_id) VALUES ($1)", [
    userId,
  ]);
  await client.query(
    "INSERT INTO admin_limits (user_id, can_execute) VALUES ($1, TRUE)",
    [userId],
  );
  console.warn(
    `[db] Bootstrapped admin account "${ADMIN_EMAIL}". Change the password after first login.`,
  );
}

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for PostgreSQL");
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function initPg(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(SCHEMA);
    await migratePg(client);
    await seedAdminPg(client);
  } finally {
    client.release();
  }
}

function mapRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => normalizeRow(r) as T);
}

export async function pgQuery<T = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(adaptSql(sql, "postgres"), params);
  return mapRows<T>(result.rows);
}

export async function pgQueryOne<T = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await pgQuery<T>(sql, params);
  return rows[0] ?? null;
}

export async function pgExecute(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  const result = await getPool().query(adaptSql(sql, "postgres"), params);
  return {
    changes: result.rowCount ?? 0,
    lastInsertId: 0,
  };
}

export async function pgTransaction<T>(
  fn: (helpers: {
    query: <R>(sql: string, params?: unknown[]) => Promise<R[]>;
    execute: (sql: string, params?: unknown[]) => Promise<ExecuteResult>;
    insertReturningId: (sql: string, params?: unknown[]) => Promise<number>;
  }) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const helpers = {
      query: async <R>(sql: string, params: unknown[] = []) => {
        const result = await client.query(adaptSql(sql, "postgres"), params);
        return mapRows<R>(result.rows);
      },
      execute: async (sql: string, params: unknown[] = []) => {
        const result = await client.query(adaptSql(sql, "postgres"), params);
        return { changes: result.rowCount ?? 0, lastInsertId: 0 };
      },
      insertReturningId: async (sql: string, params: unknown[] = []) => {
        const base = adaptSql(sql, "postgres");
        const withReturning = /RETURNING\s+/i.test(base)
          ? base
          : `${base} RETURNING id`;
        const result = await client.query(withReturning, params);
        return Number(result.rows[0]?.id ?? 0);
      },
    };
    const result = await fn(helpers);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function pgLoadBootstrapKeys(): Promise<{
  encryptionKey?: string;
  appSecret?: string;
}> {
  const rows = await pgQuery<{ key: string; value: string }>(
    "SELECT key, value FROM platform_config WHERE key IN ('ENCRYPTION_KEY', 'APP_SECRET') AND plain = 1",
  );
  const out: { encryptionKey?: string; appSecret?: string } = {};
  for (const row of rows) {
    if (row.key === "ENCRYPTION_KEY") out.encryptionKey = String(row.value);
    if (row.key === "APP_SECRET") out.appSecret = String(row.value);
  }
  return out;
}

export async function pgLoadPlatformConfig(): Promise<
  { key: string; value: string; plain: number }[]
> {
  return pgQuery("SELECT key, value, plain FROM platform_config");
}

export async function pgInsertReturningId(
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const base = adaptSql(sql, "postgres");
  const withReturning = /RETURNING\s+/i.test(base)
    ? base
    : `${base} RETURNING id`;
  const result = await getPool().query(withReturning, params);
  return Number(result.rows[0]?.id ?? 0);
}
