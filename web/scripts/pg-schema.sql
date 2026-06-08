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
  daily_loss_limit_pct     DOUBLE PRECISION NOT NULL DEFAULT 5,
  monthly_loss_limit_pct   DOUBLE PRECISION NOT NULL DEFAULT 15,
  allowed_assets           TEXT NOT NULL DEFAULT '["BTCUSDT","ETHUSDT"]',
  send_screenshot          BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_chat_id         TEXT,
  kill_switch              BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_done          BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id
  ON users (telegram_id) WHERE telegram_id IS NOT NULL;
