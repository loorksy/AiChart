import fs from "fs";
import path from "path";
import crypto from "crypto";
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
    active_market            TEXT NOT NULL DEFAULT 'forex',
    -- User-chosen forex connection: 'ea' (bridge installed on the user's MT5)
    -- or 'mt5local' (server-side, no download). NULL = operator's global default.
    forex_backend            TEXT,
    send_screenshot          INTEGER NOT NULL DEFAULT 1,
    telegram_chat_id         TEXT,
    kill_switch              INTEGER NOT NULL DEFAULT 0,
    -- 1 = riskGuard enforces all risk/permission gates (safe default);
    -- 0 = full-autonomous (agent + committee are the sole authority). Stored as
    -- INTEGER on BOTH backends on purpose, to avoid the pg-BOOLEAN equality trap.
    risk_guard_enabled       INTEGER NOT NULL DEFAULT 1,
    onboarding_done          INTEGER NOT NULL DEFAULT 0,
    alerts_enabled           INTEGER NOT NULL DEFAULT 1,
    alert_trades             INTEGER NOT NULL DEFAULT 1,
    alert_signals            INTEGER NOT NULL DEFAULT 1,
    alert_min_confidence     INTEGER NOT NULL DEFAULT 0,
    min_confidence           INTEGER NOT NULL DEFAULT 80,
    min_rr                   REAL NOT NULL DEFAULT 1,
    trading_style            TEXT NOT NULL DEFAULT 'day',
    scalp_max_trades         INTEGER NOT NULL DEFAULT 0,
    scalp_enabled            INTEGER NOT NULL DEFAULT 0,
    scalp_execution_mode     TEXT NOT NULL DEFAULT 'paper',
    updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scalp_sessions (
    user_id        INTEGER PRIMARY KEY,
    active          INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'stopped',
    symbol          TEXT NOT NULL DEFAULT '',
    market          TEXT NOT NULL DEFAULT 'forex',
    interval        TEXT NOT NULL DEFAULT '1m',
    max_trades      INTEGER NOT NULL DEFAULT 0,
    executed_count  INTEGER NOT NULL DEFAULT 0,
    notional        REAL NOT NULL DEFAULT 0,
    execution_mode  TEXT NOT NULL DEFAULT 'paper',
    session_pnl     REAL NOT NULL DEFAULT 0,
    day_key         TEXT,
    daily_trade_count INTEGER NOT NULL DEFAULT 0,
    stop_reason     TEXT,
    started_at      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bot_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    strategy        TEXT NOT NULL DEFAULT 'grid',
    symbol          TEXT NOT NULL,
    market          TEXT NOT NULL DEFAULT 'forex',
    side            TEXT NOT NULL DEFAULT 'sell',
    config_json     TEXT NOT NULL DEFAULT '{}',
    state_json      TEXT NOT NULL DEFAULT '{"levels":[]}',
    status          TEXT NOT NULL DEFAULT 'active',
    execution_mode  TEXT NOT NULL DEFAULT 'paper',
    realized_pnl    REAL NOT NULL DEFAULT 0,
    stop_reason     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_bot_sessions_active ON bot_sessions (status, user_id);

  CREATE TABLE IF NOT EXISTS gold_agent_journal (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id          INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    payload_json    TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (bot_id) REFERENCES bot_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gold_agent_journal_bot ON gold_agent_journal (bot_id, created_at);

  CREATE TABLE IF NOT EXISTS gold_agent_performance (
    bot_id          INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    stats_json      TEXT NOT NULL DEFAULT '{}',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (bot_id) REFERENCES bot_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS gold_agent_setups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id          INTEGER NOT NULL,
    fingerprint     TEXT NOT NULL,
    stats_json      TEXT NOT NULL DEFAULT '{}',
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (bot_id) REFERENCES bot_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_gold_agent_setups_fp ON gold_agent_setups (bot_id, fingerprint);

  CREATE TABLE IF NOT EXISTS admin_limits (
    user_id             INTEGER PRIMARY KEY,
    can_execute         INTEGER NOT NULL DEFAULT 1,
    max_capital_cap     REAL NOT NULL DEFAULT 0,
    max_open_trades_cap INTEGER NOT NULL DEFAULT 0,
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
    market            TEXT NOT NULL DEFAULT 'forex',
    broker            TEXT NOT NULL DEFAULT 'mt_ea',
    entry             REAL,
    stop_loss         REAL,
    take_profit       REAL,
    confidence        INTEGER NOT NULL DEFAULT 0,
    rationale         TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    reason            TEXT,
    deny_code         TEXT,
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
    market      TEXT NOT NULL DEFAULT 'forex',
    broker      TEXT NOT NULL DEFAULT 'mt_ea',
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

  CREATE TABLE IF NOT EXISTS locks (
    name       TEXT PRIMARY KEY,
    holder     TEXT NOT NULL,
    expires_at INTEGER NOT NULL
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
    public_id  TEXT,
    title      TEXT NOT NULL DEFAULT 'محادثة جديدة',
    summary    TEXT,
    archived   INTEGER NOT NULL DEFAULT 0,
    workflow_state TEXT,
    workflow_context TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS copilot_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    conversation_id INTEGER,
    event_type      TEXT NOT NULL,
    payload_json    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_copilot_events_user ON copilot_events (user_id, event_type);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    metadata_json   TEXT,
    reasoning_summary TEXT,
    tool_calls_json TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS semantic_memories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    conversation_id INTEGER,
    category        TEXT NOT NULL,
    content         TEXT NOT NULL,
    embedding_json  TEXT,
    archived        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_semantic_memories_user ON semantic_memories (user_id, category);
  CREATE INDEX IF NOT EXISTS idx_semantic_memories_archive ON semantic_memories (archived);

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
    market              TEXT NOT NULL DEFAULT 'forex',
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

  CREATE TABLE IF NOT EXISTS dynamic_pages (
    slug          TEXT PRIMARY KEY,
    title_ar      TEXT NOT NULL,
    title_en      TEXT NOT NULL,
    content_ar    TEXT NOT NULL,
    content_en    TEXT NOT NULL,
    is_published  INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Candle Warehouse: server-side OANDA candle store. time = candle open (ms).
  CREATE TABLE IF NOT EXISTS market_candles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT NOT NULL,
    interval   TEXT NOT NULL,
    time       INTEGER NOT NULL,
    open       REAL NOT NULL,
    high       REAL NOT NULL,
    low        REAL NOT NULL,
    close      REAL NOT NULL,
    volume     REAL NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'oanda',
    complete   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(symbol, interval, time, source)
  );

  CREATE INDEX IF NOT EXISTS idx_market_candles_lookup
    ON market_candles(symbol, interval, source, time);

  -- Smart Chart Agent decision audit (never stores raw model reasoning).
  CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                         INTEGER,
    request_id                      TEXT NOT NULL,
    session_id                      TEXT,
    symbol                          TEXT,
    interval                        TEXT,
    intent                          TEXT,
    decision                        TEXT,
    confidence                      REAL,
    risk_veto                       INTEGER NOT NULL DEFAULT 0,
    news_risk                       TEXT,
    execution_requires_confirmation INTEGER NOT NULL DEFAULT 0,
    execution_confirmed             INTEGER NOT NULL DEFAULT 0,
    summary                         TEXT,
    metadata                        TEXT NOT NULL DEFAULT '{}',
    created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_user
    ON agent_audit_logs (user_id, id DESC);
`;

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_pages (
      slug          TEXT PRIMARY KEY,
      title_ar      TEXT NOT NULL,
      title_en      TEXT NOT NULL,
      content_ar    TEXT NOT NULL,
      content_en    TEXT NOT NULL,
      is_published  INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const seedPages = [
    {
      slug: "privacy-policy",
      title_ar: "سياسة الخصوصية",
      title_en: "Privacy Policy",
      content_ar: "# سياسة الخصوصية\n\nنحن في **Lonora** نلتزم بحماية خصوصيتك وأمان بياناتك المالية والشخصية.\n\n### 1. جمع المعلومات\nنقوم بجمع المعلومات اللازمة فقط لربط حسابات التداول الخاصة بك وتنفيذ صفقاتك بأمان. لا نقوم بمشاركة أي بيانات سرية مع أي طرف ثالث.\n\n### 2. حماية البيانات\nيتم تشفير جميع مفاتيح API وكلمات المرور الخاصة بك باستخدام خوارزميات تشفير متقدمة على مستوى الخادم.",
      content_en: "# Privacy Policy\n\nAt **Lonora**, we are committed to protecting your privacy and the security of your financial and personal data.\n\n### 1. Data Collection\nWe collect only the information necessary to connect your trading accounts and execute trades securely. We never share sensitive data with third parties.\n\n### 2. Data Protection\nAll API keys and passwords are encrypted using state-of-the-art server-side encryption algorithms."
    },
    {
      slug: "terms-of-service",
      title_ar: "الشروط والأحكام",
      title_en: "Terms of Service",
      content_ar: "# الشروط والأحكام\n\nمرحباً بك في منصة **Lonora**. باستخدامك لخدماتنا، فإنك توافق على الالتزام بالشروط التالية.\n\n### 1. شروط الاستخدام\nيجب أن تكون مؤهلاً قانونياً للتداول واستخدام منصات التداول. المنصة تقدم خدمات اتخاذ القرارات والربط البرمجي فقط.\n\n### 2. المسؤولية\nأنت مسؤول بشكل كامل عن الصفقات والقرارات التي يتم تنفيذها من خلال المنصة.",
      content_en: "# Terms of Service\n\nWelcome to **Lonora**. By using our services, you agree to comply with the following terms.\n\n### 1. Conditions of Use\nYou must be legally eligible to trade and use financial platforms. The platform provides decision support and programmatic connectivity only.\n\n### 2. Liability\nYou are fully responsible for the trades and decisions executed through the platform."
    },
    {
      slug: "user-agreement",
      title_ar: "اتفاقية الاستخدام",
      title_en: "User Agreement",
      content_ar: "# اتفاقية الاستخدام\n\nتوضح هذه الاتفاقية الحقوق والالتزامات المتبادلة بين المستخدم ومنصة **Lonora**.\n\n### 1. ترخيص الخدمة\nتمنحك المنصة ترخيصاً محدداً وغير حصري للوصول إلى أدوات تحليل البيانات ووكيل التداول الذكي.\n\n### 2. الحسابات والاشتراكات\nيجب الحفاظ على سرية معلومات الدخول والتحقق الثنائي لضمان أمان حسابك.",
      content_en: "# User Agreement\n\nThis agreement outlines the mutual rights and obligations between the user and the **Lonora** platform.\n\n### 1. Service License\nThe platform grants you a limited, non-exclusive license to access data analysis tools and the smart trading agent.\n\n### 2. Accounts and Subscriptions\nCredentials and two-factor authentication parameters must be kept confidential to ensure account safety."
    },
    {
      slug: "risk-disclosure",
      title_ar: "إخلاء المسؤولية عن مخاطر التداول",
      title_en: "Risk Disclosure",
      content_ar: "# إخلاء المسؤولية عن مخاطر التداول\n\n> [!WARNING]\n> التداول في أسواق الفوركس والرافعة المالية ينطوي على مخاطر خسارة مالية كبيرة.\n\n### 1. مخاطر السوق\nالأسعار متقلبة بشكل كبير والرافعة المالية قد تضاعف الخسائر كما تضاعف الأرباح.\n\n### 2. عدم وجود ضمانات\nلا تقدم منصة **Lonora** أي ضمانات بتحقيق أرباح. الأداء السابق لا يضمن الأداء المستقبلي.",
      content_en: "# Risk Disclosure\n\n> [!WARNING]\n> Trading in forex and leveraged markets carries significant risk of financial loss.\n\n### 1. Market Risks\nPrices are highly volatile, and leverage can multiply losses just as it multiplies profits.\n\n### 2. No Guarantees\nThe **Lonora** platform makes no guarantees of profits. Past performance does not guarantee future results."
    },
    {
      slug: "about-us",
      title_ar: "من نحن",
      title_en: "About Us",
      content_ar: "# من نحن\n\n**Lonora** هي منصة متكاملة تجمع بين أدوات تحليل الشارتات المتقدمة ووكيل الذكاء الاصطناعي الذكي لتوجيه صفقاتك بنقرة واحدة.\n\n### رؤيتنا\nتمكين المتداولين الأفراد من استخدام أدوات تداول مؤسساتية تعتمد على الذكاء الاصطناعي لإدارة المخاطر وتحسين الأداء.",
      content_en: "# About Us\n\n**Lonora** is an integrated platform combining advanced charting tools and an intelligent AI agent to guide your trades in a single click.\n\n### Our Vision\nEmpowering retail traders to use institutional-grade AI-powered trading tools to manage risk and optimize performance."
    },
    {
      slug: "blog",
      title_ar: "المدونة الرسمية",
      title_en: "Official Blog",
      content_ar: "# المدونة الرسمية لمنصة Lonora\n\nتابع أحدث مقالاتنا وتحليلات السوق وتحديثات الذكاء الاصطناعي.\n\n- **كيف يعمل التداول الآلي بالذكاء الاصطناعي؟**\n- **استراتيجيات إدارة المخاطر وتجنب التصفية.**\n- **التحديثات الأخيرة لوكلاء التداول وكتابة السيناريوهات.**",
      content_en: "# Lonora Official Blog\n\nFollow our latest articles, market analysis, and AI updates.\n\n- **How AI-Assisted Trading Works?**\n- **Risk Management Strategies and Avoiding Liquidation.**\n- **Latest Updates on Trading Agents and Scripting.**"
    },
    {
      slug: "contact-us",
      title_ar: "تواصل معنا",
      title_en: "Contact Us",
      content_ar: "# تواصل معنا\n\nفريق الدعم الفني متواجد لمساعدتك على مدار الساعة.\n\n- **البريد الإلكتروني:** support@aichart.com\n- **التليجرام:** @AiChartSupportBot\n- **الموقع:** مركز دبي المالي العالمي، دبي، الإمارات العربية المتحدة.",
      content_en: "# Contact Us\n\nOur technical support team is available 24/7 to assist you.\n\n- **Email:** support@aichart.com\n- **Telegram:** @AiChartSupportBot\n- **Location:** DIFC, Dubai, United Arab Emirates."
    }
  ];

  for (const page of seedPages) {
    db.prepare(`
      INSERT OR IGNORE INTO dynamic_pages (slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json)
      VALUES (?, ?, ?, ?, ?, 1, '{}')
    `).run(page.slug, page.title_ar, page.title_en, page.content_ar, page.content_en);
  }

  const scalpCols = db
    .prepare("PRAGMA table_info(scalp_sessions)")
    .all() as { name: string }[];
  const addScalpCol = (name: string, ddl: string) => {
    if (!scalpCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE scalp_sessions ADD COLUMN ${ddl}`);
    }
  };
  addScalpCol("status", "status TEXT NOT NULL DEFAULT 'stopped'");
  addScalpCol("execution_mode", "execution_mode TEXT NOT NULL DEFAULT 'paper'");
  addScalpCol("session_pnl", "session_pnl REAL NOT NULL DEFAULT 0");
  addScalpCol("day_key", "day_key TEXT");
  addScalpCol("daily_trade_count", "daily_trade_count INTEGER NOT NULL DEFAULT 0");
  addScalpCol("stop_reason", "stop_reason TEXT");
  // Backfill status from the legacy `active` flag.
  if (!scalpCols.some((c) => c.name === "status")) {
    db.exec(
      "UPDATE scalp_sessions SET status = CASE WHEN active = 1 THEN 'active' ELSE 'stopped' END",
    );
  }

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
  if (!settingsCols.some((c) => c.name === "risk_guard_enabled")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN risk_guard_enabled INTEGER NOT NULL DEFAULT 1",
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
      "ALTER TABLE trading_settings ADD COLUMN active_market TEXT NOT NULL DEFAULT 'forex'",
    );
  }
  if (!settingsCols.some((c) => c.name === "forex_backend")) {
    db.exec("ALTER TABLE trading_settings ADD COLUMN forex_backend TEXT");
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
  if (!settingsCols.some((c) => c.name === "min_confidence")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN min_confidence INTEGER NOT NULL DEFAULT 80",
    );
    db.exec("UPDATE trading_settings SET min_confidence = 80 WHERE min_confidence IS NULL");
  }
  if (!settingsCols.some((c) => c.name === "min_rr")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN min_rr REAL NOT NULL DEFAULT 1",
    );
    db.exec("UPDATE trading_settings SET min_rr = 1 WHERE min_rr IS NULL");
  }
  if (!settingsCols.some((c) => c.name === "trading_style")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN trading_style TEXT NOT NULL DEFAULT 'day'",
    );
  }
  if (!settingsCols.some((c) => c.name === "scalp_max_trades")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN scalp_max_trades INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "scalp_enabled")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN scalp_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.some((c) => c.name === "scalp_execution_mode")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN scalp_execution_mode TEXT NOT NULL DEFAULT 'paper'",
    );
  }

  const tradeCols = db
    .prepare("PRAGMA table_info(trades)")
    .all() as { name: string }[];
  if (!tradeCols.some((c) => c.name === "oco_order_list_id")) {
    db.exec("ALTER TABLE trades ADD COLUMN oco_order_list_id TEXT");
  }
  if (!tradeCols.some((c) => c.name === "market")) {
    db.exec("ALTER TABLE trades ADD COLUMN market TEXT NOT NULL DEFAULT 'forex'");
  }
  if (!tradeCols.some((c) => c.name === "broker")) {
    db.exec("ALTER TABLE trades ADD COLUMN broker TEXT NOT NULL DEFAULT 'mt_ea'");
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
      "ALTER TABLE trade_intents ADD COLUMN market TEXT NOT NULL DEFAULT 'forex'",
    );
  }
  if (!intentCols.some((c) => c.name === "broker")) {
    db.exec(
      "ALTER TABLE trade_intents ADD COLUMN broker TEXT NOT NULL DEFAULT 'mt_ea'",
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
  if (!intentCols.some((c) => c.name === "deny_code")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN deny_code TEXT");
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
        'METAAPI_REGION'
      )
  `);

  if (!recCols.some((c) => c.name === "committee_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN committee_json TEXT");
  }
  if (!recCols.some((c) => c.name === "memory_refs_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN memory_refs_json TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_lessons (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL,
      trade_id            INTEGER NOT NULL,
      recommendation_id   INTEGER,
      symbol              TEXT NOT NULL,
      market              TEXT NOT NULL DEFAULT 'forex',
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      user_id     INTEGER NOT NULL,
      key         TEXT NOT NULL,
      result_json TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
      ON idempotency_keys (expires_at);
  `);

  const dupToken = db
    .prepare(
      `SELECT token_hash FROM ea_connections
       GROUP BY token_hash HAVING COUNT(*) > 1 LIMIT 1`,
    )
    .get() as { token_hash: string } | undefined;

  if (!dupToken) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ea_connections_token_unique
        ON ea_connections (token_hash);
    `);
  } else {
    console.warn(
      "[db] duplicate ea_connections.token_hash — skipping unique index",
    );
  }

  // AI Agent Memory Architecture migrations
  const chatCols = db
    .prepare("PRAGMA table_info(chat_messages)")
    .all() as { name: string }[];
  if (!chatCols.some((c) => c.name === "reasoning_summary")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN reasoning_summary TEXT");
  }
  if (!chatCols.some((c) => c.name === "tool_calls_json")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN tool_calls_json TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_memories (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      conversation_id INTEGER,
      category        TEXT NOT NULL,
      content         TEXT NOT NULL,
      embedding_json  TEXT,
      archived        INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_memories_user ON semantic_memories (user_id, category);
    CREATE INDEX IF NOT EXISTS idx_semantic_memories_archive ON semantic_memories (archived);
  `);

  // AI Copilot state & events migrations
  const convCols = db
    .prepare("PRAGMA table_info(conversations)")
    .all() as { name: string }[];
  if (!convCols.some((c) => c.name === "workflow_state")) {
    db.exec("ALTER TABLE conversations ADD COLUMN workflow_state TEXT");
  }
  if (!convCols.some((c) => c.name === "workflow_context")) {
    db.exec("ALTER TABLE conversations ADD COLUMN workflow_context TEXT");
  }
  // Opaque public id (slug) for non-enumerable conversation URLs.
  if (!convCols.some((c) => c.name === "public_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN public_id TEXT");
    // Backfill existing rows with a random 14-char hex slug.
    const rows = db
      .prepare("SELECT id FROM conversations WHERE public_id IS NULL")
      .all() as { id: number }[];
    const upd = db.prepare("UPDATE conversations SET public_id = ? WHERE id = ?");
    for (const r of rows) {
      upd.run(crypto.randomBytes(7).toString("hex"), r.id);
    }
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_public_id ON conversations (public_id)",
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS copilot_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      conversation_id INTEGER,
      event_type      TEXT NOT NULL,
      payload_json    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_copilot_events_user ON copilot_events (user_id, event_type);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS gold_agent_journal (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL,
      bot_id            INTEGER NOT NULL,
      side              TEXT NOT NULL,
      entry_price       REAL NOT NULL,
      exit_price        REAL NOT NULL,
      lot               REAL NOT NULL,
      pnl               REAL NOT NULL,
      regime            TEXT NOT NULL,
      session           TEXT NOT NULL,
      confidence        REAL NOT NULL,
      trade_quality     REAL NOT NULL,
      trade_score       REAL NOT NULL,
      danger_level      TEXT NOT NULL,
      advisor_votes_json TEXT NOT NULL,
      weights_json      TEXT NOT NULL,
      exit_reason       TEXT NOT NULL,
      duration_ms       INTEGER NOT NULL,
      fingerprint       TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gold_agent_journal_bot ON gold_agent_journal (user_id, bot_id);

    CREATE TABLE IF NOT EXISTS gold_agent_performance (
      user_id     INTEGER NOT NULL,
      bot_id      INTEGER NOT NULL,
      stats_json  TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, bot_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gold_agent_setups (
      user_id       INTEGER NOT NULL,
      bot_id        INTEGER NOT NULL,
      fingerprint   TEXT NOT NULL,
      win_rate      REAL NOT NULL DEFAULT 0,
      profit_factor REAL NOT NULL DEFAULT 1,
      samples       INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, bot_id, fingerprint),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chart_layouts (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      symbol     TEXT NOT NULL DEFAULT 'EURUSD',
      interval   TEXT NOT NULL DEFAULT '15m',
      state_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chart_layouts_user ON chart_layouts(user_id);
  `);

  dropLegacyBotAndScalpTables(db);

  db.exec(`
    UPDATE trading_settings SET active_market = 'forex' WHERE active_market = 'crypto';
    UPDATE trades SET market = 'forex' WHERE market = 'crypto';
    UPDATE trade_intents SET market = 'forex' WHERE market = 'crypto';
    UPDATE recommendations SET market = 'forex' WHERE market = 'crypto';
    UPDATE trades SET broker = 'mt_ea' WHERE broker = 'binance';
    UPDATE trade_intents SET broker = 'mt_ea' WHERE broker = 'binance';
    DROP TABLE IF EXISTS binance_accounts;
  `);
}

function dropLegacyBotAndScalpTables(db: import("better-sqlite3").Database) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("DROP TABLE IF EXISTS scalp_sessions");
  db.exec("DROP TABLE IF EXISTS bot_sessions");
  db.exec("PRAGMA foreign_keys = ON");
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
