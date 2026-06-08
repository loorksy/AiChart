import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { ADMIN_EMAIL, ADMIN_PASSWORD, DB_PATH } from "./env";

let _db: Database.Database | null = null;

function init(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
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
      allowed_assets           TEXT NOT NULL DEFAULT '["BTCUSDT","ETHUSDT"]',
      send_screenshot          INTEGER NOT NULL DEFAULT 1,
      telegram_chat_id         TEXT,
      kill_switch              INTEGER NOT NULL DEFAULT 0,
      updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Admin-imposed caps. These are the hard ceilings enforced in code,
    -- independent of what the user requests in trading_settings.
    CREATE TABLE IF NOT EXISTS admin_limits (
      user_id             INTEGER PRIMARY KEY,
      can_execute         INTEGER NOT NULL DEFAULT 0,
      max_capital_cap     REAL NOT NULL DEFAULT 0,
      max_open_trades_cap INTEGER NOT NULL DEFAULT 1,
      claude_quota        INTEGER NOT NULL DEFAULT 1000,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Recommendations produced by the expert agent (advisory; no execution yet).
    CREATE TABLE IF NOT EXISTS recommendations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      symbol       TEXT NOT NULL,
      action       TEXT NOT NULL,
      confidence   INTEGER NOT NULL DEFAULT 0,
      entry        REAL,
      stop_loss    REAL,
      take_profit  REAL,
      timeframe    TEXT,
      rationale    TEXT,
      factors      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Per-day Claude request counter, used to enforce the admin quota.
    CREATE TABLE IF NOT EXISTS claude_usage (
      user_id    INTEGER NOT NULL,
      day        TEXT NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- A proposed trade awaiting approval (manual) or immediate execution
    -- (delegate). Every execution path passes through the Risk Guard.
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

    -- Executed trades.
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

    -- Global key/value flags (e.g. master kill switch).
    CREATE TABLE IF NOT EXISTS system_flags (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- One-time codes for linking a user's Telegram account.
    CREATE TABLE IF NOT EXISTS telegram_link_codes (
      code       TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_settings_tg
      ON trading_settings (telegram_chat_id);
  `);

  migrate(db);
  seedAdmin(db);
}

/** Adds columns introduced after initial release (safe to run repeatedly). */
function migrate(db: Database.Database) {
  const cols = db
    .prepare("PRAGMA table_info(recommendations)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "factors")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN factors TEXT");
  }
}

function seedAdmin(db: Database.Database) {
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(ADMIN_EMAIL.toLowerCase()) as { id: number } | undefined;
  if (existing) return;

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?, ?, 'admin', 'active')",
    )
    .run(ADMIN_EMAIL.toLowerCase(), hash);
  const userId = Number(info.lastInsertRowid);
  db.prepare(
    "INSERT INTO trading_settings (user_id) VALUES (?)",
  ).run(userId);
  db.prepare(
    "INSERT INTO admin_limits (user_id, can_execute) VALUES (?, 1)",
  ).run(userId);
  console.warn(
    `[db] Bootstrapped admin account "${ADMIN_EMAIL}". Change the password after first login.`,
  );
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.resolve(process.cwd(), DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  init(_db);
  return _db;
}
