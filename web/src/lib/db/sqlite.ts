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
    mode                     TEXT NOT NULL DEFAULT 'advisory',
    approval                 TEXT NOT NULL DEFAULT 'manual',
    experience               TEXT NOT NULL DEFAULT 'beginner',
    style                    TEXT NOT NULL DEFAULT 'conservative',
    max_capital              REAL NOT NULL DEFAULT 0,
    per_trade_pct            REAL NOT NULL DEFAULT 10,
    max_open_trades          INTEGER NOT NULL DEFAULT 1,
    daily_profit_target_pct  REAL NOT NULL DEFAULT 3,
    daily_loss_limit_pct     REAL NOT NULL DEFAULT 5,
    monthly_loss_limit_pct   REAL NOT NULL DEFAULT 15,
    allowed_assets           TEXT NOT NULL DEFAULT '[]',
    send_screenshot          INTEGER NOT NULL DEFAULT 1,
    telegram_chat_id         TEXT,
    kill_switch              INTEGER NOT NULL DEFAULT 0,
    onboarding_done          INTEGER NOT NULL DEFAULT 0,
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
    status      TEXT NOT NULL DEFAULT 'open',
    pnl         REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at   TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS system_flags (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

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

  const settingsCols = db
    .prepare("PRAGMA table_info(trading_settings)")
    .all() as { name: string }[];
  if (!settingsCols.some((c) => c.name === "onboarding_done")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0",
    );
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

  db.exec(`
    UPDATE platform_config SET plain = 1
    WHERE plain = 0
      AND key IN (
        'ANTHROPIC_MODEL',
        'TELEGRAM_BOT_USERNAME',
        'APP_URL',
        'ENABLE_BINANCE_CLI'
      )
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
