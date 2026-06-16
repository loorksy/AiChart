import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { DB_PATH } from "../env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../constants";
import type { DbRow, ExecuteResult } from "./types";

let _db: Database.Database | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS binance_accounts (
    user_id        INTEGER PRIMARY KEY,
    api_key_enc    TEXT NOT NULL,
    api_secret_enc TEXT NOT NULL,
    env            TEXT NOT NULL DEFAULT 'testnet',
    label          TEXT,
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trading_settings (
    user_id                  INTEGER PRIMARY KEY,
    mode                     TEXT NOT NULL DEFAULT 'approval',
    approval                 TEXT NOT NULL DEFAULT 'manual',
    experience               TEXT NOT NULL DEFAULT 'beginner',
    style                    TEXT NOT NULL DEFAULT 'conservative',
    max_capital              REAL NOT NULL DEFAULT 0,
    per_trade_pct            REAL NOT NULL DEFAULT 10,
    max_open_trades          INTEGER NOT NULL DEFAULT 1,
    daily_profit_target_pct  REAL NOT NULL DEFAULT 3,
    daily_profit_target_usd  REAL NOT NULL DEFAULT 0,
    daily_loss_limit_pct     REAL NOT NULL DEFAULT 5,
    monthly_loss_limit_pct   REAL NOT NULL DEFAULT 15,
    auto_take_profit_usd     REAL NOT NULL DEFAULT 0,
    allowed_assets           TEXT NOT NULL DEFAULT '[]',
    active_market            TEXT NOT NULL DEFAULT 'crypto',
    send_screenshot          INTEGER NOT NULL DEFAULT 1,
    telegram_chat_id         TEXT,
    kill_switch              INTEGER NOT NULL DEFAULT 0,
    onboarding_done          INTEGER NOT NULL DEFAULT 0,
    alerts_enabled           INTEGER NOT NULL DEFAULT 1,
    alert_trades             INTEGER NOT NULL DEFAULT 1,
    alert_signals            INTEGER NOT NULL DEFAULT 1,
    alert_min_confidence     INTEGER NOT NULL DEFAULT 0,
    updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_limits (
    user_id             INTEGER PRIMARY KEY,
    can_execute         INTEGER NOT NULL DEFAULT 0,
    max_capital_cap     REAL NOT NULL DEFAULT 0,
    max_open_trades_cap INTEGER NOT NULL DEFAULT 1,
    claude_quota        INTEGER NOT NULL DEFAULT 1000,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    symbol          TEXT NOT NULL,
    action          TEXT NOT NULL,
    confidence      INTEGER NOT NULL DEFAULT 0,
    entry           REAL,
    stop_loss       REAL,
    take_profit     REAL,
    timeframe       TEXT,
    rationale       TEXT,
    factors         TEXT,
    chart_image_url TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS claude_usage (
    user_id    INTEGER NOT NULL,
    day        TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trade_intents (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    recommendation_id INTEGER,
    symbol            TEXT NOT NULL,
    side              TEXT NOT NULL,
    notional          REAL NOT NULL,
    market            TEXT NOT NULL DEFAULT 'crypto',
    broker            TEXT NOT NULL DEFAULT 'binance',
    entry             REAL,
    stop_loss         REAL,
    take_profit       REAL,
    confidence        INTEGER NOT NULL DEFAULT 0,
    rationale         TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    reason            TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    intent_id   INTEGER,
    symbol      TEXT NOT NULL,
    side        TEXT NOT NULL,
    qty         REAL NOT NULL DEFAULT 0,
    quote_qty   REAL NOT NULL DEFAULT 0,
    avg_price   REAL NOT NULL DEFAULT 0,
    order_id    TEXT,
    env         TEXT NOT NULL DEFAULT 'testnet',
    market      TEXT NOT NULL DEFAULT 'crypto',
    broker      TEXT NOT NULL DEFAULT 'binance',
    status      TEXT NOT NULL DEFAULT 'open',
    pnl         REAL NOT NULL DEFAULT 0,
    oco_order_list_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at   TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ea_connections (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    platform          TEXT NOT NULL DEFAULT 'mt5',
    token_hash        TEXT NOT NULL,
    label             TEXT,
    broker_name       TEXT,
    account_login     TEXT,
    account_currency  TEXT,
    balance           REAL NOT NULL DEFAULT 0,
    equity            REAL NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'offline',
    symbol_specs_json TEXT,
    last_heartbeat_at TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ea_connections_user
    ON ea_connections (user_id);
  CREATE INDEX IF NOT EXISTS idx_ea_connections_token
    ON ea_connections (token_hash);

  CREATE TABLE IF NOT EXISTS ea_commands (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    intent_id     INTEGER,
    command_type  TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    result_json   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at    TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ea_commands_poll
    ON ea_commands (user_id, status, id);

  CREATE TABLE IF NOT EXISTS ea_market_cache (
    user_id      INTEGER NOT NULL,
    symbol       TEXT NOT NULL,
    interval     TEXT NOT NULL,
    candles_json TEXT NOT NULL,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, symbol, interval),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mt_accounts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    platform            TEXT NOT NULL DEFAULT 'mt5',
    server              TEXT NOT NULL,
    login               TEXT NOT NULL,
    password_enc        TEXT NOT NULL,
    metaapi_account_id  TEXT NOT NULL,
    region              TEXT,
    state               TEXT NOT NULL DEFAULT 'CREATED',
    connection_status   TEXT,
    balance             REAL NOT NULL DEFAULT 0,
    equity              REAL NOT NULL DEFAULT 0,
    currency            TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
    token_hash  TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    email       TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_mcp_refresh_client
    ON mcp_oauth_refresh_tokens (client_id, revoked);

  CREATE TABLE IF NOT EXISTS platform_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    plain      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code       TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL DEFAULT 'محادثة جديدة',
    summary    TEXT,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    metadata_json   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations (user_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_chat_messages_conv
    ON chat_messages (conversation_id, id);

  CREATE INDEX IF NOT EXISTS idx_settings_tg
    ON trading_settings (telegram_chat_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS scan_cooldowns (
    user_id    INTEGER NOT NULL,
    symbol     TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, symbol),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alert_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    symbol     TEXT,
    delivered  INTEGER NOT NULL DEFAULT 0,
    read_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_alert_log_user
    ON alert_log (user_id, id DESC);

  CREATE TABLE IF NOT EXISTS trade_lessons (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    trade_id            INTEGER NOT NULL,
    recommendation_id   INTEGER,
    symbol              TEXT NOT NULL,
    market              TEXT NOT NULL DEFAULT 'crypto',
    timeframe           TEXT,
    pattern_name        TEXT,
    outcome             TEXT NOT NULL,
    pnl                 REAL NOT NULL DEFAULT 0,
    pnl_pct             REAL NOT NULL DEFAULT 0,
    entry_context_json  TEXT,
    lesson_ar           TEXT NOT NULL,
    tags_json           TEXT,
    embedding_json      TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_trade_lessons_user
    ON trade_lessons (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_trade_lessons_symbol
    ON trade_lessons (user_id, symbol);
`;

function migrate(db: Database.Database) {
  const recCols = db
    .prepare("PRAGMA table_info(recommendations)")
    .all() as { name: string }[];
  if (!recCols.some((c) => c.name === "factors")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN factors TEXT");
  }
  if (!recCols.some((c) => c.name === "chart_image_url")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN chart_image_url TEXT");
  }
  if (!recCols.some((c) => c.name === "chart_drawings_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN chart_drawings_json TEXT");
  }
  if (!recCols.some((c) => c.name === "pattern_name")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN pattern_name TEXT");
  }
  if (!recCols.some((c) => c.name === "analysis_tier")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN analysis_tier TEXT");
  }
  if (!recCols.some((c) => c.name === "context_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN context_json TEXT");
  }
  if (!recCols.some((c) => c.name === "source")) {
    db.exec(
      "ALTER TABLE recommendations ADD COLUMN source TEXT NOT NULL DEFAULT 'web'",
    );
  }
  if (!recCols.some((c) => c.name === "market")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN market TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_pending (
      user_id    INTEGER PRIMARY KEY,
      intent_id  INTEGER NOT NULL,
      step       TEXT NOT NULL,
      message_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const settingsCols = db
    .prepare("PRAGMA table_info(trading_settings)")
    .all() as { name: string }[];
  if (!settingsCols.some((c) => c.name === "onboarding_done")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "alerts_enabled")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN alerts_enabled INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!settingsCols.some((c) => c.name === "alert_trades")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN alert_trades INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!settingsCols.some((c) => c.name === "alert_signals")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN alert_signals INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!settingsCols.some((c) => c.name === "alert_min_confidence")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN alert_min_confidence INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "daily_profit_target_usd")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN daily_profit_target_usd REAL NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "auto_take_profit_usd")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN auto_take_profit_usd REAL NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "active_market")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN active_market TEXT NOT NULL DEFAULT 'crypto'",
    );
  }
  if (!settingsCols.some((c) => c.name === "last_manual_scan_at")) {
    db.exec("ALTER TABLE trading_settings ADD COLUMN last_manual_scan_at TEXT");
  }
  if (!settingsCols.some((c) => c.name === "scan_poll_minutes")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN scan_poll_minutes INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "analysis_interval")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN analysis_interval TEXT NOT NULL DEFAULT '1h'",
    );
  }
  if (!settingsCols.some((c) => c.name === "execution_env_preference")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN execution_env_preference TEXT NOT NULL DEFAULT 'demo'",
    );
  }

  const tradeCols = db
    .prepare("PRAGMA table_info(trades)")
    .all() as { name: string }[];
  if (!tradeCols.some((c) => c.name === "oco_order_list_id")) {
    db.exec("ALTER TABLE trades ADD COLUMN oco_order_list_id TEXT");
  }
  if (!tradeCols.some((c) => c.name === "market")) {
    db.exec("ALTER TABLE trades ADD COLUMN market TEXT NOT NULL DEFAULT 'crypto'");
  }
  if (!tradeCols.some((c) => c.name === "broker")) {
    db.exec("ALTER TABLE trades ADD COLUMN broker TEXT NOT NULL DEFAULT 'binance'");
  }
  if (!tradeCols.some((c) => c.name === "market_type")) {
    db.exec(
      "ALTER TABLE trades ADD COLUMN market_type TEXT NOT NULL DEFAULT 'spot'",
    );
  }
  if (!tradeCols.some((c) => c.name === "leverage")) {
    db.exec("ALTER TABLE trades ADD COLUMN leverage REAL NOT NULL DEFAULT 1");
  }
  if (!tradeCols.some((c) => c.name === "order_type")) {
    db.exec(
      "ALTER TABLE trades ADD COLUMN order_type TEXT NOT NULL DEFAULT 'market'",
    );
  }

  const intentCols = db
    .prepare("PRAGMA table_info(trade_intents)")
    .all() as { name: string }[];
  if (!intentCols.some((c) => c.name === "market")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN market TEXT NOT NULL DEFAULT 'crypto'",
    );
  }
  if (!intentCols.some((c) => c.name === "broker")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN broker TEXT NOT NULL DEFAULT 'binance'",
    );
  }
  if (!intentCols.some((c) => c.name === "practice")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN practice INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!intentCols.some((c) => c.name === "market_type")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN market_type TEXT NOT NULL DEFAULT 'spot'",
    );
  }
  if (!intentCols.some((c) => c.name === "leverage")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN leverage REAL NOT NULL DEFAULT 1",
    );
  }
  if (!intentCols.some((c) => c.name === "order_type")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN order_type TEXT NOT NULL DEFAULT 'market'",
    );
  }
  if (!intentCols.some((c) => c.name === "limit_price")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN limit_price REAL");
  }
  if (!tradeCols.some((c) => c.name === "limit_price")) {
    db.exec("ALTER TABLE trades ADD COLUMN limit_price REAL");
  }

  // Futures is opt-in per user (settings) with an admin hard leverage cap.
  if (!settingsCols.some((c) => c.name === "futures_enabled")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN futures_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "default_leverage")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN default_leverage REAL NOT NULL DEFAULT 3",
    );
  }
  const limitCols = db
    .prepare("PRAGMA table_info(admin_limits)")
    .all() as { name: string }[];
  if (!limitCols.some((c) => c.name === "max_leverage_cap")) {
    db.exec(
      "ALTER TABLE admin_limits ADD COLUMN max_leverage_cap REAL NOT NULL DEFAULT 10",
    );
  }

  const eaCols = db
    .prepare("PRAGMA table_info(ea_connections)")
    .all() as { name: string }[];
  if (!eaCols.some((c) => c.name === "account_trade_mode")) {
    db.exec("ALTER TABLE ea_connections ADD COLUMN account_trade_mode TEXT");
  }
  if (!eaCols.some((c) => c.name === "positions_json")) {
    db.exec("ALTER TABLE ea_connections ADD COLUMN positions_json TEXT");
  }

  const alertCols = db
    .prepare("PRAGMA table_info(alert_log)")
    .all() as { name: string }[];
  if (!alertCols.some((c) => c.name === "read_at")) {
    db.exec("ALTER TABLE alert_log ADD COLUMN read_at TEXT");
  }
  if (!alertCols.some((c) => c.name === "image_url")) {
    db.exec("ALTER TABLE alert_log ADD COLUMN image_url TEXT");
  }

  const userCols = db
    .prepare("PRAGMA table_info(users)")
    .all() as { name: string }[];
  if (!userCols.some((c) => c.name === "telegram_id")) {
    db.exec("ALTER TABLE users ADD COLUMN telegram_id INTEGER");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id) WHERE telegram_id IS NOT NULL",
    );
  }
  const userCols2 = db
    .prepare("PRAGMA table_info(users)")
    .all() as { name: string }[];
  if (!userCols2.some((c) => c.name === "access_expires_at")) {
    db.exec("ALTER TABLE users ADD COLUMN access_expires_at TEXT");
  }
  const userCols3 = db
    .prepare("PRAGMA table_info(users)")
    .all() as { name: string }[];
  if (!userCols3.some((c) => c.name === "username")) {
    db.exec("ALTER TABLE users ADD COLUMN username TEXT");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username) WHERE username IS NOT NULL",
    );
  }
  const userCols4 = db
    .prepare("PRAGMA table_info(users)")
    .all() as { name: string }[];
  if (!userCols4.some((c) => c.name === "whatsapp_e164")) {
    db.exec("ALTER TABLE users ADD COLUMN whatsapp_e164 TEXT");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whatsapp ON users (whatsapp_e164) WHERE whatsapp_e164 IS NOT NULL",
    );
  }

  db.exec(`
    UPDATE platform_config SET plain = 1
    WHERE plain = 0
      AND key IN (
        'ANTHROPIC_MODEL',
        'TELEGRAM_BOT_USERNAME',
        'APP_URL',
        'ENABLE_BINANCE_CLI',
        'METAAPI_REGION'
      )
  `);

  if (!recCols.some((c) => c.name === "committee_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN committee_json TEXT");
  }
  if (!recCols.some((c) => c.name === "memory_refs_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN memory_refs_json TEXT");
  }

  const binanceSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='binance_accounts'")
    .get() as { sql?: string } | undefined;
  if (
    binanceSql?.sql &&
    !binanceSql.sql.includes("PRIMARY KEY (user_id, env)")
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS binance_accounts_v2 (
        user_id        INTEGER NOT NULL,
        api_key_enc    TEXT NOT NULL,
        api_secret_enc TEXT NOT NULL,
        env            TEXT NOT NULL DEFAULT 'testnet',
        label          TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, env),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO binance_accounts_v2
        (user_id, api_key_enc, api_secret_enc, env, label, updated_at)
      SELECT user_id, api_key_enc, api_secret_enc, env, label, updated_at
        FROM binance_accounts;
      DROP TABLE binance_accounts;
      ALTER TABLE binance_accounts_v2 RENAME TO binance_accounts;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_lessons (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      trade_id            INTEGER NOT NULL,
      recommendation_id   INTEGER,
      symbol              TEXT NOT NULL,
      market              TEXT NOT NULL DEFAULT 'crypto',
      timeframe           TEXT,
      pattern_name        TEXT,
      outcome             TEXT NOT NULL,
      pnl                 REAL NOT NULL DEFAULT 0,
      pnl_pct             REAL NOT NULL DEFAULT 0,
      entry_context_json  TEXT,
      lesson_ar           TEXT NOT NULL,
      tags_json           TEXT,
      embedding_json      TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_trade_lessons_user
      ON trade_lessons (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_lessons_symbol
      ON trade_lessons (user_id, symbol);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mt_accounts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      platform            TEXT NOT NULL DEFAULT 'mt5',
      server              TEXT NOT NULL,
      login               TEXT NOT NULL,
      password_enc        TEXT NOT NULL,
      metaapi_account_id  TEXT NOT NULL,
      region              TEXT,
      state               TEXT NOT NULL DEFAULT 'CREATED',
      connection_status   TEXT,
      balance             REAL NOT NULL DEFAULT 0,
      equity              REAL NOT NULL DEFAULT 0,
      currency            TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mt_accounts_user
      ON mt_accounts (user_id);
  `);
}

export function seedAdminSqlite(db: Database.Database) {
  const adminEmail = ADMIN_EMAIL.toLowerCase();
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(adminEmail) as { id: number } | undefined;

  if (existingAdmin) {
    db.prepare(
      "UPDATE users SET role = 'admin', status = 'active' WHERE id = ?",
    ).run(existingAdmin.id);
    db.prepare(
      "INSERT INTO trading_settings (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING",
    ).run(existingAdmin.id);
    db.prepare(
      "INSERT INTO admin_limits (user_id, can_execute) VALUES (?, 1) ON CONFLICT (user_id) DO UPDATE SET can_execute = 1",
    ).run(existingAdmin.id);
    return;
  }

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'admin', 'active')",
    )
    .run(adminEmail, hash);
  const userId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO trading_settings (user_id) VALUES (?)").run(userId);
  db.prepare(
    "INSERT INTO admin_limits (user_id, can_execute) VALUES (?, 1)",
  ).run(userId);
  console.warn(
    `[db] Bootstrapped admin account "${ADMIN_EMAIL}". Change the password after first login.`,
  );
}

function initDb(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seedAdminSqlite(db);
}

export function getSqliteDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  initDb(_db);
  return _db;
}

export async function initSqlite(): Promise<void> {
  getSqliteDb();
}

export async function sqliteQuery<T = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return getSqliteDb().prepare(sql).all(...params) as T[];
}

export async function sqliteQueryOne<T = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const row = getSqliteDb().prepare(sql).get(...params) as T | undefined;
  return row ?? null;
}

export async function sqliteExecute(
  sql: string,
  params: unknown[] = [],
): Promise<ExecuteResult> {
  const info = getSqliteDb().prepare(sql).run(...params);
  return {
    changes: info.changes,
    lastInsertId: Number(info.lastInsertRowid),
  };
}

export async function sqliteTransaction<T>(
  fn: (helpers: {
    query: typeof sqliteQuery;
    execute: typeof sqliteExecute;
    insertReturningId: (sql: string, params?: unknown[]) => Promise<number>;
  }) => Promise<T>,
): Promise<T> {
  const helpers = {
    query: sqliteQuery,
    execute: sqliteExecute,
    insertReturningId: async (sql: string, params: unknown[] = []) => {
      const result = await sqliteExecute(sql, params);
      return result.lastInsertId;
    },
  };
  return fn(helpers);
}

export async function sqliteLoadBootstrapKeys(): Promise<{
  encryptionKey?: string;
  appSecret?: string;
}> {
  const rows = await sqliteQuery<{ key: string; value: string; plain: number }>(
    "SELECT key, value, plain FROM platform_config WHERE key IN ('ENCRYPTION_KEY', 'APP_SECRET') AND plain = 1",
  );
  const out: { encryptionKey?: string; appSecret?: string } = {};
  for (const row of rows) {
    if (row.key === "ENCRYPTION_KEY") out.encryptionKey = row.value;
    if (row.key === "APP_SECRET") out.appSecret = row.value;
  }
  return out;
}

export async function sqliteLoadPlatformConfig(): Promise<
  { key: string; value: string; plain: number }[]
> {
  return sqliteQuery("SELECT key, value, plain FROM platform_config");
}
