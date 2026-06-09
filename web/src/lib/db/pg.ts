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
    mode                     TEXT NOT NULL DEFAULT 'advisory',
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
    send_screenshot          BOOLEAN NOT NULL DEFAULT TRUE,
    telegram_chat_id         TEXT,
    kill_switch              BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_done          BOOLEAN NOT NULL DEFAULT FALSE,
    alerts_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    alert_trades             BOOLEAN NOT NULL DEFAULT TRUE,
    alert_signals            BOOLEAN NOT NULL DEFAULT TRUE,
    alert_min_confidence     INTEGER NOT NULL DEFAULT 0,
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
    status      TEXT NOT NULL DEFAULT 'open',
    pnl         DOUBLE PRECISION NOT NULL DEFAULT 0,
    oco_order_list_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS system_flags (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

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
`;

async function migratePg(client: PoolClient) {
  await client.query(`
    UPDATE platform_config SET plain = TRUE
    WHERE plain = FALSE
      AND key IN (
        'ANTHROPIC_MODEL',
        'TELEGRAM_BOT_USERNAME',
        'APP_URL',
        'ENABLE_BINANCE_CLI'
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
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS oco_order_list_id TEXT
  `).catch(() => {});

  await client.query(`
    ALTER TABLE alert_log ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ
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
