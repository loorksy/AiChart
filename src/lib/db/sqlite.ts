import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { DB_PATH } from "../env";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../constants";
import {
  buildSupportContactPage,
  LEGACY_SEEDED_DYNAMIC_PAGE_SLUGS,
  migrateLegacyDynamicPageBranding,
  type DynamicPageBrandFields,
} from "./dynamicPageBranding";
import type { DbRow, ExecuteResult } from "./types";
import {
  DOCS_MT5_LINKING_CONTENT_AR,
  DOCS_MT5_LINKING_CONTENT_EN,
  DOCS_MT5_LINKING_STALE_MARKERS,
} from "../content/docsMt5LinkingCopy";

let _db: Database.Database | null = null;
let _transactionTail: Promise<void> = Promise.resolve();
const SCHEMA_VERSION = "2026-08-04-symbol-catalogue-v1";

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
    per_trade_pct            REAL NOT NULL DEFAULT 1
      CHECK (
        per_trade_pct >= 0.1
        AND per_trade_pct <= 5
        AND ABS(per_trade_pct * 10 - ROUND(per_trade_pct * 10)) < 0.000000001
      ),
    allowed_assets           TEXT NOT NULL DEFAULT '[]',
    -- User-chosen forex connection: 'metaapi' (cloud) or 'mt5local'
    -- (server-side bridge, no download). NULL = operator's global default.
    -- Migration below rewrites any leftover 'ea' value to NULL; resolution
    -- also treats an unrecognised value as NULL, so this is belt and braces.
    forex_backend            TEXT,
    -- Kept for stored-settings compatibility: the user's own linked
    -- MetaTrader account ('metaapi') is the only pipe now, so every value
    -- resolves to it.
    market_data_source       TEXT,
    -- "provider/model" the USER picked for their own analyses; NULL = the
    -- platform default. The admin supplies keys, the user picks the brain.
    preferred_model_ref      TEXT,
    send_screenshot          INTEGER NOT NULL DEFAULT 1,
    telegram_chat_id         TEXT,
    onboarding_done          INTEGER NOT NULL DEFAULT 0,
    alerts_enabled           INTEGER NOT NULL DEFAULT 1,
    alert_push               INTEGER NOT NULL DEFAULT 1,
    -- Standing execution authorisation: 'unset' until a connected operator
    -- chooses. The epoch pins an 'auto' grant to the connection it was given
    -- for, so it cannot silently survive a disconnect and reconnect.
    agent_trade_mode         TEXT NOT NULL DEFAULT 'unset',
    agent_trade_mode_updated_at INTEGER,
    agent_trade_mode_epoch   TEXT,
    alert_trades             INTEGER NOT NULL DEFAULT 1,
    alert_signals            INTEGER NOT NULL DEFAULT 1,
    -- Per-user pinned pairs in the picker. JSON string array of broker
    -- spellings (case preserved) when the cloud pipe is active.
    favourite_symbols        TEXT NOT NULL DEFAULT '[]',
    updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Shared instrument seed from connected cloud accounts (N7). Origin is
  -- recorded so a broker-sourced row is never labelled as the platform feed.
  CREATE TABLE IF NOT EXISTS symbol_catalogue (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    broker_symbol        TEXT NOT NULL,
    canonical            TEXT NOT NULL,
    origin               TEXT NOT NULL CHECK (origin IN ('oanda', 'broker')),
    seeded_by_user_id    INTEGER,
    metaapi_account_id   TEXT,
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (origin, broker_symbol),
    FOREIGN KEY (seeded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_symbol_catalogue_canonical
    ON symbol_catalogue (canonical);

  CREATE TABLE IF NOT EXISTS admin_limits (
    user_id             INTEGER PRIMARY KEY,
    can_execute         INTEGER NOT NULL DEFAULT 1,
    claude_quota        INTEGER NOT NULL DEFAULT 1000,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    analysis_id     TEXT,
    session_id      TEXT,
    chat_id         TEXT,
    symbol          TEXT NOT NULL,
    action          TEXT NOT NULL,
    direction       TEXT,
    confidence      INTEGER NOT NULL DEFAULT 0,
    backtested_confidence REAL,
    confidence_low  REAL,
    confidence_high REAL,
    backtest_id     INTEGER,
    market_regime   TEXT,
    entry           REAL,
    stop_loss       REAL,
    take_profit     REAL,
    targets_json    TEXT NOT NULL DEFAULT '[]',
    risk_json       TEXT NOT NULL DEFAULT '{}',
    timeframe       TEXT,
    strategy_id     TEXT NOT NULL DEFAULT 'unspecified',
    strategy_version TEXT NOT NULL DEFAULT '1',
    expires_at      INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    status_reason   TEXT NOT NULL DEFAULT '',
    engine_version  TEXT NOT NULL DEFAULT 'legacy',
    entry_type      TEXT,
    legacy_tracking_id TEXT,
    effective_revision_no INTEGER,
    plan_type       TEXT,
    execution_state TEXT,
    statistical_support TEXT,
    -- Where the decision's support actually came from. Named separately from
    -- statistical_support (a GRADE) because the source and its strength are
    -- different facts: direct_analysis | strategy_supported | historical_memory
    -- | deep_research. NULL on rows written before it existed — never given a
    -- value that would imply evidence the row does not have.
    evidence_source TEXT,
    updated_at      INTEGER,
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

  -- V2-A1: one row per LLM call. user_id NULL = platform/system spend.
  CREATE TABLE IF NOT EXISTS usage_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER,
    ts                INTEGER NOT NULL,
    provider          TEXT NOT NULL,
    model             TEXT NOT NULL,
    kind              TEXT NOT NULL DEFAULT 'other',
    input_tokens      INTEGER NOT NULL DEFAULT 0,
    output_tokens     INTEGER NOT NULL DEFAULT 0,
    provider_cost_usd REAL,
    retail_cost_usd   REAL,
    request_id        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_usage_events_user_ts ON usage_events(user_id, ts);
  CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts);

  -- V2-A1: admin-editable provider list prices (USD per 1M tokens).
  CREATE TABLE IF NOT EXISTS model_prices (
    provider          TEXT NOT NULL,
    model             TEXT NOT NULL,
    input_usd_per_m   REAL NOT NULL,
    output_usd_per_m  REAL NOT NULL,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (provider, model)
  );

  -- V2-A2: one active subscription per user (v0 model: tier + included credits).
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id                INTEGER PRIMARY KEY,
    tier                   TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'active',
    started_at             INTEGER NOT NULL,
    current_period_start   INTEGER NOT NULL,
    current_period_end     INTEGER NOT NULL,
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    updated_at             INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- V2-A2: audit trail of every credit movement (USD retail).
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    ts          INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    amount_usd  REAL NOT NULL,
    bucket      TEXT NOT NULL DEFAULT 'monthly',
    ref         TEXT,
    note        TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_ts ON credit_ledger(user_id, ts);

  -- V2-A2: fast-path balances the gate reads (ledger stays the audit truth).
  CREATE TABLE IF NOT EXISTS credit_balances (
    user_id     INTEGER PRIMARY KEY,
    monthly_usd REAL NOT NULL DEFAULT 0,
    topup_usd   REAL NOT NULL DEFAULT 0,
    period_end  INTEGER,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- V2-A3: webhook idempotency — one row per applied Stripe event.
  CREATE TABLE IF NOT EXISTS stripe_events (
    id   TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    ts   INTEGER NOT NULL
  );

  -- V2-C: support tickets, answered first by the docs-grounded bot.
  CREATE TABLE IF NOT EXISTS support_tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    subject     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',
    assigned_to INTEGER,
    needs_human INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at);

  CREATE TABLE IF NOT EXISTS support_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id  INTEGER NOT NULL,
    author     TEXT NOT NULL,
    author_id  INTEGER,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, created_at);

  -- V2-B: MetaApi deploy-hour metering (billed only while deployed).
  CREATE TABLE IF NOT EXISTS metaapi_deploy_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    account_id    TEXT NOT NULL,
    deployed_at   INTEGER NOT NULL,
    undeployed_at INTEGER,
    hours         REAL,
    retail_usd    REAL,
    reason        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_metaapi_sessions_user ON metaapi_deploy_sessions(user_id, deployed_at);

  -- V2-B: presence heartbeat driving deploy/undeploy.
  CREATE TABLE IF NOT EXISTS mt_presence (
    user_id   INTEGER PRIMARY KEY,
    last_seen INTEGER NOT NULL
  );

  -- V2-A6: fine-grained admin roles (role='admin' users are implicit owners).
  CREATE TABLE IF NOT EXISTS admin_roles (
    user_id    INTEGER PRIMARY KEY,
    admin_role TEXT NOT NULL,
    granted_by INTEGER,
    granted_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- V2-A6: who did what in the admin panel — money and permission actions.
  CREATE TABLE IF NOT EXISTS admin_audit (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action   TEXT NOT NULL,
    target   TEXT,
    detail   TEXT,
    ts       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit(ts);

  -- V2-A4: external identity links (Google today; provider column keeps it open).
  CREATE TABLE IF NOT EXISTS oauth_identities (
    provider   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    email      TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);

  CREATE TABLE IF NOT EXISTS trade_intents (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    recommendation_id INTEGER,
    -- Which revision of that recommendation this order was built from, and who
    -- authorised it. Both are checked again at execution time.
    recommendation_revision_no INTEGER,
    authorization_source TEXT,
    symbol            TEXT NOT NULL,
    side              TEXT NOT NULL,
    notional          REAL NOT NULL,
    market            TEXT NOT NULL DEFAULT 'forex',
    broker            TEXT NOT NULL DEFAULT 'metaapi',
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
    broker      TEXT NOT NULL DEFAULT 'metaapi',
    status      TEXT NOT NULL DEFAULT 'open',
    pnl         REAL NOT NULL DEFAULT 0,
    oco_order_list_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at   TEXT,
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
    account_trade_mode  TEXT,
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
    source          TEXT NOT NULL DEFAULT 'agent',
    memory_type     TEXT NOT NULL DEFAULT 'conversation_summary',
    confidence      REAL NOT NULL DEFAULT 0.8,
    safety_classification TEXT NOT NULL DEFAULT 'untrusted_content',
    expires_at      TEXT,
    last_used_at    TEXT,
    use_count       INTEGER NOT NULL DEFAULT 0,
    source_chat_id  TEXT,
    source_message_id TEXT,
    source_recommendation_id TEXT,
    source_trade_id TEXT,
    locale          TEXT,
    symbol          TEXT,
    timeframe       TEXT,
    strategy_id     TEXT,
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

  -- One row per real change already announced. The unique key is what makes a
  -- re-run of the sweep silent: the same recommendation, revision, and event
  -- can only ever be delivered once, however many times it is evaluated.
  CREATE TABLE IF NOT EXISTS alert_dedupe (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    dedupe_key  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    symbol      TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE (user_id, dedupe_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_alert_dedupe_recent
    ON alert_dedupe (user_id, created_at DESC);

  -- Browser/mobile push endpoints. One row per device the operator opted in
  -- from; a rejected endpoint is deleted on the next send rather than retried
  -- forever, since the browser has already told us it is gone.
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER,
    UNIQUE (endpoint),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions (user_id);

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

  -- Historical case memory: one row per indexed market moment.
  -- Features come from candles at or before case_time; the outcome_* columns are
  -- computed from candles strictly after it. That split is the whole point, so
  -- the two groups are written by different functions and never mixed.
  CREATE TABLE IF NOT EXISTS market_cases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol          TEXT NOT NULL,
    interval        TEXT NOT NULL,
    case_time       INTEGER NOT NULL,
    direction       TEXT NOT NULL,
    regime          TEXT NOT NULL,
    trend           TEXT NOT NULL,
    range_zone      TEXT NOT NULL,
    pullback_depth  REAL NOT NULL,
    impulse_atr     REAL NOT NULL,
    volatility      REAL NOT NULL,
    session         TEXT NOT NULL,
    structure_run   INTEGER NOT NULL,
    pattern_name    TEXT,
    pattern_stage   TEXT,
    entry_price     REAL NOT NULL,
    atr             REAL NOT NULL,
    -- The boundary that would complete a forming pattern, frozen at case_time
    -- like every other feature. NULL when no pattern (or no single boundary)
    -- was present, and on rows indexed before partial-stage outcomes existed.
    break_level     REAL,
    break_direction TEXT,
    -- NULL while the forward window is still open (a case at the edge of the
    -- warehouse has no future yet); filled once the horizon is available.
    outcome         TEXT,
    outcome_bars    INTEGER,
    max_favourable  REAL,
    max_adverse     REAL,
    net_r           REAL,
    -- Partial-stage outcomes (plan §12): only cases indexed on a FORMING
    -- pattern carry these; computed strictly from candles after case_time.
    forming_outcome TEXT,
    forming_bars    INTEGER,
    false_break     INTEGER,
    early_net_r     REAL,
    confirmed_net_r REAL,
    session_cost    REAL,
    indexer_version INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(symbol, interval, case_time, direction, indexer_version)
  );

  -- Re-evaluation triggers (constitution §6). A trigger REQUESTS a new decision
  -- cycle; it never changes a plan. Recorded whether or not a cycle followed, so
  -- "why was this re-decided" and "why was it not" are both answerable.
  CREATE TABLE IF NOT EXISTS recommendation_reevaluations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id TEXT NOT NULL,
    user_id           INTEGER NOT NULL,
    symbol            TEXT NOT NULL,
    reason            TEXT NOT NULL,
    detail            TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL,
    revision_no       INTEGER,
    outcome           TEXT NOT NULL,
    raised_at         INTEGER NOT NULL,
    dedupe_key        TEXT NOT NULL,
    -- Fingerprint of the bundle the cycle decided on, so a confirmed verdict is
    -- traceable to the evidence that confirmed it.
    evidence_hash     TEXT,
    trigger_payload_json TEXT NOT NULL DEFAULT '{}',
    evidence_json     TEXT NOT NULL DEFAULT '{}',
    decision_trace_json TEXT NOT NULL DEFAULT '{}',
    claimed_at        INTEGER,
    completed_at      INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (recommendation_id, dedupe_key)
  );

  CREATE INDEX IF NOT EXISTS idx_recommendation_reevaluations_lookup
    ON recommendation_reevaluations(recommendation_id, raised_at DESC);

  -- Platform/MCP decision parity (plan §16, completion criterion 2). One row per
  -- surface per evidence bundle; two rows with the same evidence_hash are the
  -- only pair that is meaningfully comparable.
  CREATE TABLE IF NOT EXISTS decision_parity (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_hash    TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    timeframe_set    TEXT NOT NULL DEFAULT '[]',
    market_timestamp INTEGER NOT NULL,
    surface          TEXT NOT NULL,
    decision_json    TEXT NOT NULL DEFAULT '{}',
    created_at       INTEGER NOT NULL,
    -- What makes two surfaces COMPARABLE: symbol, interval and the closed
    -- candle they decided on. evidence_hash cannot serve, because the snapshot
    -- it covers embeds live candles, the live spread and per-run chart images,
    -- so two surfaces never produced the same hash and no pair was ever formed.
    parity_key       TEXT,
    UNIQUE (evidence_hash, surface)
  );

  CREATE INDEX IF NOT EXISTS idx_decision_parity_recent
    ON decision_parity(created_at DESC);

  -- Durable paired Platform/MCP comparison once both surfaces used the same
  -- Evidence Snapshot. Raw per-surface observations remain above.
  CREATE TABLE IF NOT EXISTS decision_parity_comparisons (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_hash             TEXT NOT NULL UNIQUE,
    symbol                    TEXT NOT NULL,
    timeframe_set             TEXT NOT NULL DEFAULT '[]',
    market_timestamp          INTEGER NOT NULL,
    platform_decision         TEXT NOT NULL DEFAULT '{}',
    mcp_decision              TEXT NOT NULL DEFAULT '{}',
    direction                 TEXT NOT NULL DEFAULT '{}',
    plan_type                 TEXT NOT NULL DEFAULT '{}',
    entry_zone                TEXT NOT NULL DEFAULT '{}',
    stop                      TEXT NOT NULL DEFAULT '{}',
    targets                   TEXT NOT NULL DEFAULT '{}',
    execution_state           TEXT NOT NULL DEFAULT '{}',
    difference_classification TEXT,
    explained                 INTEGER NOT NULL DEFAULT 1,
    explanation               TEXT NOT NULL DEFAULT '',
    created_at                INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_decision_parity_comparisons_recent
    ON decision_parity_comparisons(created_at DESC);

  -- Live spread samples per symbol×session (plan §13 H.1), aggregated on
  -- read. Written by the MetaApi streaming listener (lib/metaapi/streaming.ts)
  -- at most once per symbol per minute from ticks it already receives.
  CREATE TABLE IF NOT EXISTS cost_samples (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    session     TEXT NOT NULL,
    spread_pips REAL NOT NULL,
    observed_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cost_samples_lookup
    ON cost_samples(symbol, observed_at);

  CREATE INDEX IF NOT EXISTS idx_market_cases_lookup
    ON market_cases(symbol, interval, regime, trend, direction);
  CREATE INDEX IF NOT EXISTS idx_market_cases_pending
    ON market_cases(symbol, interval, outcome, case_time);

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
    news_risk                       TEXT,
    execution_requires_confirmation INTEGER NOT NULL DEFAULT 0,
    execution_confirmed             INTEGER NOT NULL DEFAULT 0,
    summary                         TEXT,
    metadata                        TEXT NOT NULL DEFAULT '{}',
    created_at                      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_user
    ON agent_audit_logs (user_id, id DESC);

  -- Per-user custom agent skills (full SKILL.md text; trust is always "user").
  CREATE TABLE IF NOT EXISTS user_agent_skills (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    content    TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, chat_id TEXT, session_id TEXT,
    request_id TEXT NOT NULL, symbol TEXT, timeframe TEXT, intent TEXT,
    status TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, cancelled_at INTEGER,
    decision TEXT, confidence REAL,
    error_code TEXT, feature_flags TEXT NOT NULL DEFAULT '{}', context_version TEXT,
    context_message_count INTEGER NOT NULL DEFAULT 0, recalled_memory_count INTEGER NOT NULL DEFAULT 0,
    skill_names TEXT NOT NULL DEFAULT '[]', tool_names TEXT NOT NULL DEFAULT '[]', token_usage TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs (user_id, started_at DESC);
  CREATE TABLE IF NOT EXISTS agent_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, user_id INTEGER NOT NULL,
    step_type TEXT NOT NULL, status TEXT NOT NULL, summary TEXT,
    evidence_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON agent_run_steps (run_id, id);
  CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id INTEGER NOT NULL,
    tool_name TEXT NOT NULL, tool_version TEXT, permission TEXT, status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0, input_preview TEXT, output_preview TEXT,
    error_code TEXT, retry_count INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, completed_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls (run_id, started_at);

  CREATE TABLE IF NOT EXISTS agent_chats (
    id                   TEXT PRIMARY KEY,
    user_id              INTEGER NOT NULL,
    title                TEXT NOT NULL DEFAULT 'محادثة جديدة',
    symbol               TEXT,
    interval             TEXT,
    language             TEXT NOT NULL DEFAULT 'ar',
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    last_message_preview TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_agent_chats_user
    ON agent_chats (user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS agent_chat_messages (
    id                TEXT PRIMARY KEY,
    chat_id           TEXT NOT NULL,
    user_id           INTEGER NOT NULL,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL,
    result_json       TEXT,
    recommendation_id TEXT,
    analysis_id       TEXT,
    symbol            TEXT,
    interval          TEXT,
    created_at        INTEGER NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES agent_chats(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_chat
    ON agent_chat_messages (chat_id, created_at);

  CREATE TABLE IF NOT EXISTS tracked_recommendations (
    id                  TEXT PRIMARY KEY,
    user_id             INTEGER NOT NULL,
    chat_id             TEXT,
    analysis_id         TEXT,
    symbol              TEXT NOT NULL,
    interval            TEXT NOT NULL,
    direction           TEXT NOT NULL,
    entry_type          TEXT NOT NULL,
    entry               REAL NOT NULL,
    stop_loss           REAL NOT NULL,
    targets             TEXT NOT NULL DEFAULT '[]',
    invalidation_level  REAL,
    status              TEXT NOT NULL,
    outcome             TEXT NOT NULL DEFAULT 'pending',
    setup_type          TEXT,
    rr                  REAL,
    created_at          INTEGER NOT NULL,
    created_candle_time INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    triggered_at        INTEGER,
    tp1_hit_at          INTEGER,
    tp2_hit_at          INTEGER,
    tp3_hit_at          INTEGER,
    sl_hit_at           INTEGER,
    invalidated_at      INTEGER,
    cancelled_at        INTEGER,
    expired_at          INTEGER,
    price_at_creation   REAL,
    last_checked_at     INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tracked_recs_user
    ON tracked_recommendations (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tracked_recs_outcome
    ON tracked_recommendations (outcome);

  CREATE TABLE IF NOT EXISTS recommendation_history (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id INTEGER NOT NULL,
    user_id           INTEGER NOT NULL,
    kind              TEXT NOT NULL,
    occurred_at       INTEGER NOT NULL,
    actor             TEXT NOT NULL,
    source            TEXT NOT NULL,
    payload_json      TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_history_replay
    ON recommendation_history (user_id, recommendation_id, occurred_at, id);

  -- Every edit to a live recommendation lands here as a new row; the pointer
  -- column effective_revision_no on recommendations says which one is in force.
  -- Prior revisions stay readable but stop being executable, so a level the
  -- agent has since moved can never be filled, and "what did it say at the
  -- time" always has an answer. evidence_json freezes the bundle it decided on.
  CREATE TABLE IF NOT EXISTS recommendation_revisions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id INTEGER NOT NULL,
    user_id           INTEGER NOT NULL,
    revision_no       INTEGER NOT NULL,
    direction         TEXT NOT NULL,
    plan_type         TEXT,
    execution_state   TEXT,
    entry             REAL,
    entry_low         REAL,
    entry_high        REAL,
    stop_loss         REAL,
    targets_json      TEXT NOT NULL DEFAULT '[]',
    -- The operator-facing sentence, and beside it the only machine-checked
    -- form. A revision without the JSON rule has no condition anything can
    -- evaluate, so it falls back to entry semantics rather than guessing.
    activation_condition TEXT,
    activation_rule_json TEXT,
    invalidation_rule TEXT,
    alternative_scenario TEXT,
    validity_candles  INTEGER,
    expires_at        INTEGER,
    reason            TEXT NOT NULL,
    source            TEXT NOT NULL,
    evidence_hash     TEXT,
    evidence_json     TEXT NOT NULL DEFAULT '{}',
    decision_trace_json TEXT NOT NULL DEFAULT '{}',
    created_at        INTEGER NOT NULL,
    UNIQUE (recommendation_id, revision_no),
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_revisions_lookup
    ON recommendation_revisions (user_id, recommendation_id, revision_no DESC);

  -- The frozen evidence the brain actually decided on, stored whole and apart
  -- from the operator-facing card. The revision used to keep only the graded
  -- card while its evidence_hash claimed to fingerprint the bundle — two
  -- different objects. snapshot_json is the CANONICAL text the fingerprint was
  -- taken over, so the stored hash always matches what is stored.
  CREATE TABLE IF NOT EXISTS recommendation_evidence_snapshots (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    recommendation_id INTEGER NOT NULL,
    revision_no       INTEGER NOT NULL,
    fingerprint       TEXT NOT NULL,
    source_surface    TEXT NOT NULL,
    schema_version    INTEGER NOT NULL DEFAULT 1,
    snapshot_json     TEXT NOT NULL,
    created_at        INTEGER NOT NULL,
    UNIQUE (recommendation_id, revision_no),
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_snapshots_lookup
    ON recommendation_evidence_snapshots (user_id, recommendation_id, revision_no DESC);

  CREATE TABLE IF NOT EXISTS recommendation_transitions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id INTEGER NOT NULL,
    user_id           INTEGER NOT NULL,
    from_status       TEXT,
    to_status         TEXT NOT NULL,
    occurred_at       INTEGER NOT NULL,
    trigger_name      TEXT NOT NULL,
    actor             TEXT NOT NULL,
    source            TEXT NOT NULL,
    reason            TEXT NOT NULL,
    metadata_json     TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_transitions_replay
    ON recommendation_transitions (user_id, recommendation_id, occurred_at, id);

  CREATE TABLE IF NOT EXISTS recommendation_outcomes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id INTEGER NOT NULL,
    user_id           INTEGER NOT NULL,
    outcome_type      TEXT NOT NULL,
    target_index      INTEGER,
    price             REAL,
    r_multiple        REAL,
    pnl               REAL,
    holding_ms        INTEGER,
    mae               REAL,
    mfe               REAL,
    spread_cost       REAL,
    slippage          REAL,
    commission        REAL,
    risk_used         REAL,
    occurred_at       INTEGER NOT NULL,
    source            TEXT NOT NULL,
    evidence_json     TEXT NOT NULL DEFAULT '{}',
    dedupe_key        TEXT NOT NULL,
    UNIQUE (recommendation_id, dedupe_key),
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_outcomes_replay
    ON recommendation_outcomes (user_id, recommendation_id, occurred_at, id);

  CREATE TABLE IF NOT EXISTS recommendation_learning_events (
    event_id          TEXT PRIMARY KEY,
    recommendation_id INTEGER NOT NULL,
    user_id           INTEGER NOT NULL,
    event_type        TEXT NOT NULL,
    occurred_at       INTEGER NOT NULL,
    source_outcome_id INTEGER,
    payload_json      TEXT NOT NULL DEFAULT '{}',
    evidence_json     TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_learning_events_user
    ON recommendation_learning_events (user_id, event_type, occurred_at);

  -- ── The gold candle store ────────────────────────────────────────────────
  --
  -- Backtests need bars, and OANDA is a rate-limited API rather than a
  -- database: re-fetching five years of 15m candles for every strategy run is
  -- how "lightning backtests" become an overnight job. So closed bars are kept.
  --
  -- No symbol column, on purpose. This platform trades one instrument, and a
  -- symbol column is an invitation to store a second one — the exact drift
  -- gold-only exists to prevent. The timeframe IS the partition.
  --
  -- Only CLOSED bars are ever written. A forming bar's high and low are still
  -- moving, and a backtest that read one would be trading on a candle the
  -- market had not finished printing.
  CREATE TABLE IF NOT EXISTS gold_candles (
    timeframe  TEXT NOT NULL,
    time       INTEGER NOT NULL,
    open       REAL NOT NULL,
    high       REAL NOT NULL,
    low        REAL NOT NULL,
    close      REAL NOT NULL,
    volume     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (timeframe, time)
  );
  CREATE INDEX IF NOT EXISTS idx_gold_candles_time
    ON gold_candles (timeframe, time DESC);

  -- ── The backtest result cache ────────────────────────────────────────────
  --
  -- What makes a backtest "lightning" is not running it faster — it is not
  -- running it again. A strategy's result over a fixed window of closed bars
  -- cannot change, so it is computed once and read thereafter.
  --
  -- The key is the whole claim: which strategy, at which spec revision, on
  -- which timeframe, over exactly which bars. A revision bump or a deeper store
  -- produces a different key and therefore a real re-run, which is the point —
  -- a cache that survived a spec change would serve results for a strategy that
  -- no longer exists.
  CREATE TABLE IF NOT EXISTS backtest_results (
    cache_key      TEXT PRIMARY KEY,
    strategy_id    TEXT NOT NULL,
    spec_revision  TEXT NOT NULL,
    timeframe      TEXT NOT NULL,
    bars_from      INTEGER NOT NULL,
    bars_to        INTEGER NOT NULL,
    bar_count      INTEGER NOT NULL,
    backtest_id    INTEGER,
    job_id         TEXT,
    status         TEXT NOT NULL,
    trade_count    INTEGER,
    win_rate       REAL,
    metrics_json   TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy
    ON backtest_results (strategy_id, timeframe, updated_at DESC);

  CREATE TABLE IF NOT EXISTS strategy_backtests (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id               INTEGER NOT NULL,
    strategy_id           TEXT NOT NULL,
    strategy_version      TEXT NOT NULL DEFAULT '1',
    symbol                TEXT NOT NULL,
    timeframe             TEXT NOT NULL,
    job_id                TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending',
    trade_count           INTEGER NOT NULL DEFAULT 0,
    win_rate              REAL,
    expectancy            REAL,
    sharpe_ratio          REAL,
    max_drawdown_pct      REAL,
    profit_factor         REAL,
    calibrated_confidence REAL,
    confidence_low        REAL,
    confidence_high       REAL,
    metrics_json          TEXT NOT NULL DEFAULT '{}',
    validation_json       TEXT NOT NULL DEFAULT '{}',
    error_message         TEXT,
    created_at            INTEGER NOT NULL,
    completed_at          INTEGER,
    updated_at            INTEGER NOT NULL,
    UNIQUE (user_id, job_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_strategy_backtests_lookup
    ON strategy_backtests (user_id, strategy_id, symbol, timeframe, status, completed_at);

  CREATE TABLE IF NOT EXISTS strategy_deployments (
    user_id               INTEGER NOT NULL,
    strategy_id           TEXT NOT NULL,
    symbol                TEXT NOT NULL,
    timeframe             TEXT NOT NULL,
    backtest_id           INTEGER NOT NULL,
    state                 TEXT NOT NULL DEFAULT 'shadow',
    expected_win_rate     REAL NOT NULL,
    calibrated_confidence REAL NOT NULL,
    confidence_low        REAL NOT NULL,
    confidence_high       REAL NOT NULL,
    live_sample_size      INTEGER NOT NULL DEFAULT 0,
    live_win_rate         REAL,
    suspended_reason      TEXT,
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (user_id, strategy_id, symbol, timeframe),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (backtest_id) REFERENCES strategy_backtests(id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_strategy_deployments_state
    ON strategy_deployments (user_id, state, strategy_id);

  CREATE TABLE IF NOT EXISTS trade_lesson_candidates (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER NOT NULL,
    fingerprint             TEXT NOT NULL,
    recommendation_id       INTEGER NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'candidate',
    reason                  TEXT NOT NULL,
    evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
    strategy_id             TEXT NOT NULL,
    market                  TEXT NOT NULL,
    confidence              REAL NOT NULL,
    affected_symbols_json   TEXT NOT NULL DEFAULT '[]',
    sample_size             INTEGER NOT NULL,
    created_at              INTEGER NOT NULL,
    validated_at            INTEGER,
    UNIQUE (user_id, fingerprint),
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS gold_agent_weight_versions (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER NOT NULL,
    strategy_id             TEXT NOT NULL,
    version                 INTEGER NOT NULL,
    parent_version          INTEGER,
    weights_json            TEXT NOT NULL,
    sample_size             INTEGER NOT NULL,
    confidence              REAL NOT NULL,
    decay                   REAL NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'candidate',
    evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at              INTEGER NOT NULL,
    activated_at            INTEGER,
    rolled_back_at          INTEGER,
    UNIQUE (user_id, strategy_id, version),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trading_dna_snapshots (
    snapshot_id      TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL,
    version          INTEGER NOT NULL,
    generated_at     INTEGER NOT NULL,
    window_start     INTEGER,
    window_end       INTEGER,
    sample_size      INTEGER NOT NULL,
    metrics_json     TEXT NOT NULL DEFAULT '[]',
    conclusions_json TEXT NOT NULL DEFAULT '[]',
    evidence_json    TEXT NOT NULL DEFAULT '{}',
    UNIQUE (user_id, version),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_trading_dna_snapshots_user
    ON trading_dna_snapshots (user_id, version DESC);

  CREATE TABLE IF NOT EXISTS trading_persona_versions (
    persona_id    TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    version       INTEGER NOT NULL,
    snapshot_id   TEXT NOT NULL,
    persona       TEXT NOT NULL,
    confidence    REAL NOT NULL,
    sample_size   INTEGER NOT NULL,
    rationale     TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    UNIQUE (user_id, version),
    UNIQUE (user_id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES trading_dna_snapshots(snapshot_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shadow_recommendations (
    shadow_recommendation_id TEXT PRIMARY KEY,
    user_id                  INTEGER NOT NULL,
    snapshot_id              TEXT NOT NULL,
    source_recommendation_id INTEGER,
    symbol                   TEXT NOT NULL,
    timeframe                TEXT NOT NULL,
    direction                TEXT NOT NULL CHECK (direction IN ('buy','sell','wait')),
    confidence               REAL NOT NULL,
    rationale_json           TEXT NOT NULL DEFAULT '[]',
    evidence_json            TEXT NOT NULL DEFAULT '{}',
    research_only            INTEGER NOT NULL DEFAULT 1 CHECK (research_only = 1),
    execution_prohibited     INTEGER NOT NULL DEFAULT 1 CHECK (execution_prohibited = 1),
    created_at               INTEGER NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES trading_dna_snapshots(snapshot_id) ON DELETE CASCADE,
    FOREIGN KEY (source_recommendation_id) REFERENCES recommendations(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_shadow_recommendations_user
    ON shadow_recommendations (user_id, created_at DESC);

  CREATE TRIGGER IF NOT EXISTS immutable_recommendation_history_update
    BEFORE UPDATE ON recommendation_history
    BEGIN SELECT RAISE(ABORT, 'recommendation history is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_recommendation_revisions_update
    BEFORE UPDATE ON recommendation_revisions
    BEGIN SELECT RAISE(ABORT, 'recommendation revisions are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_evidence_snapshots_update
    BEFORE UPDATE ON recommendation_evidence_snapshots
    BEGIN SELECT RAISE(ABORT, 'evidence snapshots are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_recommendation_transitions_update
    BEFORE UPDATE ON recommendation_transitions
    BEGIN SELECT RAISE(ABORT, 'recommendation transitions are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_recommendation_outcomes_update
    BEFORE UPDATE ON recommendation_outcomes
    BEGIN SELECT RAISE(ABORT, 'recommendation outcomes are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_recommendation_learning_events_update
    BEFORE UPDATE ON recommendation_learning_events
    BEGIN SELECT RAISE(ABORT, 'recommendation learning events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_trading_dna_snapshots_update
    BEFORE UPDATE ON trading_dna_snapshots
    BEGIN SELECT RAISE(ABORT, 'trading dna snapshots are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_trading_persona_versions_update
    BEFORE UPDATE ON trading_persona_versions
    BEGIN SELECT RAISE(ABORT, 'trading persona versions are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS immutable_shadow_recommendations_update
    BEFORE UPDATE ON shadow_recommendations
    BEGIN SELECT RAISE(ABORT, 'shadow recommendations are append-only'); END;
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

  const supportContacts = {
    email: process.env.SUPPORT_EMAIL,
    telegram: process.env.SUPPORT_TELEGRAM,
  };
  const supportPage = buildSupportContactPage(supportContacts);

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
      content_ar: supportPage.contentAr,
      content_en: supportPage.contentEn,
    }
  ];

  for (const page of seedPages) {
    db.prepare(`
      INSERT OR IGNORE INTO dynamic_pages (slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json)
      VALUES (?, ?, ?, ?, ?, 1, '{}')
    `).run(page.slug, page.title_ar, page.title_en, page.content_ar, page.content_en);
  }

  const selectLegacyPage = db.prepare(`
    SELECT slug, title_ar, title_en, content_ar, content_en, metadata_json
      FROM dynamic_pages
     WHERE slug = ?
  `);
  const updateLegacyPage = db.prepare(`
    UPDATE dynamic_pages
       SET title_ar = ?,
           title_en = ?,
           content_ar = ?,
           content_en = ?,
           metadata_json = ?,
           updated_at = datetime('now')
     WHERE slug = ?
  `);
  for (const slug of LEGACY_SEEDED_DYNAMIC_PAGE_SLUGS) {
    const current = selectLegacyPage.get(slug) as
      | DynamicPageBrandFields
      | undefined;
    if (!current) continue;
    const migrated = migrateLegacyDynamicPageBranding(current, supportContacts);
    if (!migrated.changed) continue;
    updateLegacyPage.run(
      migrated.page.title_ar,
      migrated.page.title_en,
      migrated.page.content_ar,
      migrated.page.content_en,
      migrated.page.metadata_json,
      migrated.page.slug,
    );
  }

  const recCols = db
    .prepare("PRAGMA table_info(recommendations)")
    .all() as { name: string }[];
  // V2-C: dynamic_pages carries blog posts and docs alongside legal pages.
  const dpCols = db
    .prepare("PRAGMA table_info(dynamic_pages)")
    .all() as { name: string }[];
  if (!dpCols.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE dynamic_pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page'");
  }
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
  const canonicalRecColumns: Array<[string, string]> = [
    ["analysis_id", "TEXT"],
    ["session_id", "TEXT"],
    ["chat_id", "TEXT"],
    ["direction", "TEXT"],
    ["targets_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["risk_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["strategy_id", "TEXT NOT NULL DEFAULT 'unspecified'"],
    ["strategy_version", "TEXT NOT NULL DEFAULT '1'"],
    ["backtested_confidence", "REAL"],
    ["confidence_low", "REAL"],
    ["confidence_high", "REAL"],
    ["backtest_id", "INTEGER"],
    ["market_regime", "TEXT"],
    ["expires_at", "INTEGER"],
    ["status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["status_reason", "TEXT NOT NULL DEFAULT ''"],
    ["engine_version", "TEXT NOT NULL DEFAULT 'legacy'"],
    ["entry_type", "TEXT"],
    ["legacy_tracking_id", "TEXT"],
    ["updated_at", "INTEGER"],
    // Which revision is in force. NULL on rows written before revisions
    // existed: those stay readable and are never treated as executable.
    ["effective_revision_no", "INTEGER"],
    ["plan_type", "TEXT"],
    ["execution_state", "TEXT"],
    ["statistical_support", "TEXT"],
    ["evidence_source", "TEXT"],
  ];
  // Additive for databases created before the parity key existed.
  const parityCols = db
    .prepare("PRAGMA table_info(decision_parity)")
    .all() as Array<{ name: string }>;
  if (parityCols.length > 0 && !parityCols.some((c) => c.name === "parity_key")) {
    db.exec("ALTER TABLE decision_parity ADD COLUMN parity_key TEXT");
  }
  // Created here, not in SCHEMA: on a database that predates the column the
  // schema pass runs before this migration, so indexing it there would fail
  // and take the whole initDb with it.
  if (parityCols.length > 0) {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_decision_parity_key ON decision_parity(parity_key, surface)",
    );
  }

  for (const [name, definition] of canonicalRecColumns) {
    if (!recCols.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE recommendations ADD COLUMN ${name} ${definition}`);
    }
  }

  // Additive for databases created before the structured activation rule
  // existed. Nullable with no default: an existing revision genuinely has no
  // rule, and inventing one would make a plan claim a condition nobody stated.
  const revisionCols = db
    .prepare("PRAGMA table_info(recommendation_revisions)")
    .all() as Array<{ name: string }>;
  if (
    revisionCols.length > 0 &&
    !revisionCols.some((column) => column.name === "activation_rule_json")
  ) {
    db.exec("ALTER TABLE recommendation_revisions ADD COLUMN activation_rule_json TEXT");
  }

  // Parity is per-operator; the unique moment index turns re-analysis inside
  // one candle into an UPDATE rather than a duplicate comparison row.
  const parityUserCols = db
    .prepare("PRAGMA table_info(decision_parity)")
    .all() as Array<{ name: string }>;
  if (parityUserCols.length > 0 && !parityUserCols.some((c) => c.name === "user_id")) {
    db.exec("ALTER TABLE decision_parity ADD COLUMN user_id INTEGER");
  }
  const cmpCols = db
    .prepare("PRAGMA table_info(decision_parity_comparisons)")
    .all() as Array<{ name: string }>;
  if (cmpCols.length > 0) {
    if (!cmpCols.some((c) => c.name === "user_id")) {
      db.exec("ALTER TABLE decision_parity_comparisons ADD COLUMN user_id INTEGER");
    }
    if (!cmpCols.some((c) => c.name === "parity_key")) {
      db.exec("ALTER TABLE decision_parity_comparisons ADD COLUMN parity_key TEXT");
    }
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_parity_comparison_moment ON decision_parity_comparisons(user_id, parity_key) WHERE user_id IS NOT NULL AND parity_key IS NOT NULL",
    );
  }
  db.exec(`
    UPDATE recommendations
       SET direction = COALESCE(direction, action),
           targets_json = CASE
             WHEN targets_json IS NULL OR targets_json = '[]'
             THEN CASE WHEN take_profit IS NULL THEN '[]' ELSE '[' || take_profit || ']' END
             ELSE targets_json
           END,
           status = CASE
             WHEN status IS NULL OR status = 'draft'
             THEN CASE
               WHEN action IN ('buy','sell') AND entry IS NOT NULL AND stop_loss IS NOT NULL AND take_profit IS NOT NULL
               THEN 'active' ELSE COALESCE(status, 'draft') END
             ELSE status END,
           expires_at = COALESCE(expires_at, (CAST(strftime('%s','now') AS INTEGER) + 14400) * 1000),
           updated_at = COALESCE(updated_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendations_legacy_tracking
      ON recommendations (user_id, legacy_tracking_id)
      WHERE legacy_tracking_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_recommendations_lifecycle
      ON recommendations (user_id, status, created_at DESC);
  `);

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
  for (const [name, definition] of [
    ["agent_trade_mode", "TEXT NOT NULL DEFAULT 'unset'"],
    ["agent_trade_mode_updated_at", "INTEGER"],
    ["agent_trade_mode_epoch", "TEXT"],
  ] as const) {
    if (!settingsCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE trading_settings ADD COLUMN ${name} ${definition}`);
    }
  }

  // Durable re-evaluation claims and the exact evidence/trace consumed by the
  // unified brain. Additive for databases created before the end-to-end cycle.
  const reevaluationCols = db
    .prepare("PRAGMA table_info(recommendation_reevaluations)")
    .all() as { name: string }[];
  for (const [name, definition] of [
    ["trigger_payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["evidence_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["decision_trace_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["claimed_at", "INTEGER"],
    ["completed_at", "INTEGER"],
  ] as const) {
    if (!reevaluationCols.some((column) => column.name === name)) {
      db.exec(
        `ALTER TABLE recommendation_reevaluations ADD COLUMN ${name} ${definition}`,
      );
    }
  }
  // Rows written by the pre-queue implementation have no claimed_at marker.
  // Treat them as historical so the first deploy cannot replay the entire old
  // trigger log. Every claim written by the resumable consumer has claimed_at.
  db.exec(
    `UPDATE recommendation_reevaluations
        SET completed_at = raised_at
      WHERE outcome = 'cycle_requested' AND completed_at IS NULL
        AND claimed_at IS NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_recommendation_reevaluations_pending
       ON recommendation_reevaluations(outcome, completed_at, user_id, claimed_at)`,
  );
  if (!settingsCols.some((c) => c.name === "alert_push")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN alert_push INTEGER NOT NULL DEFAULT 1",
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
  if (!settingsCols.some((c) => c.name === "forex_backend")) {
    db.exec("ALTER TABLE trading_settings ADD COLUMN forex_backend TEXT");
  }
  if (!settingsCols.some((c) => c.name === "preferred_model_ref")) {
    db.exec("ALTER TABLE trading_settings ADD COLUMN preferred_model_ref TEXT");
  }
  // Forward-only product simplification migration. Existing databases may
  // still contain legacy policy columns; no runtime code reads them, and they
  // are removed here after the remaining account/watchlist data is preserved.
  const obsoleteSettingsColumns = [
    "mode", "approval", "experience", "style", "max_capital",
    "max_open_trades", "daily_profit_target_pct", "daily_profit_target_usd",
    "daily_loss_limit_pct", "monthly_loss_limit_pct", "auto_take_profit_usd",
    "kill_switch", "risk_guard_enabled", "alert_min_confidence",
    "min_confidence", "min_rr", "last_manual_scan_at", "scan_poll_minutes",
    "analysis_interval", "execution_env_preference", "futures_enabled",
    "default_leverage", "trading_style", "scalp_max_trades", "scalp_enabled",
    "scalp_execution_mode", "active_market",
  ];
  const currentSettingsColumns = db
    .prepare("PRAGMA table_info(trading_settings)")
    .all() as { name: string }[];
  for (const name of obsoleteSettingsColumns) {
    if (currentSettingsColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE trading_settings DROP COLUMN ${name}`);
    }
  }

  // The broker's own account type for cloud/bridge connections. Without it the
  // live-money dual-enablement gate could not tell a real MetaApi account from
  // a demo one, and defaulted to "not live" — the same protection failure
  // already fixed on the self-hosted MT5 path.
  const currentDataSourceColumns = db
    .prepare("PRAGMA table_info(trading_settings)")
    .all() as { name: string }[];
  if (!currentDataSourceColumns.some((column) => column.name === "market_data_source")) {
    db.exec("ALTER TABLE trading_settings ADD COLUMN market_data_source TEXT");
  }
  if (!currentDataSourceColumns.some((column) => column.name === "favourite_symbols")) {
    db.exec(
      "ALTER TABLE trading_settings ADD COLUMN favourite_symbols TEXT NOT NULL DEFAULT '[]'",
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_catalogue (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      broker_symbol        TEXT NOT NULL,
      canonical            TEXT NOT NULL,
      origin               TEXT NOT NULL CHECK (origin IN ('oanda', 'broker')),
      seeded_by_user_id    INTEGER,
      metaapi_account_id   TEXT,
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (origin, broker_symbol),
      FOREIGN KEY (seeded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_symbol_catalogue_canonical
      ON symbol_catalogue (canonical);
  `);

  const currentMtColumns = db
    .prepare("PRAGMA table_info(mt_accounts)")
    .all() as { name: string }[];
  if (!currentMtColumns.some((column) => column.name === "account_trade_mode")) {
    db.exec("ALTER TABLE mt_accounts ADD COLUMN account_trade_mode TEXT");
  }

  const currentAdminColumns = db
    .prepare("PRAGMA table_info(admin_limits)")
    .all() as { name: string }[];
  for (const name of ["max_capital_cap", "max_open_trades_cap", "max_leverage_cap"]) {
    if (currentAdminColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE admin_limits DROP COLUMN ${name}`);
    }
  }

  db.exec(
    `UPDATE trading_settings
        SET per_trade_pct = CASE
          WHEN per_trade_pct IS NULL
            OR per_trade_pct < 0.1
            OR per_trade_pct > 5
          THEN 1
          ELSE ROUND(per_trade_pct, 1)
        END`,
  );

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
    db.exec("ALTER TABLE trades ADD COLUMN broker TEXT NOT NULL DEFAULT 'metaapi'");
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
      "ALTER TABLE trade_intents ADD COLUMN broker TEXT NOT NULL DEFAULT 'metaapi'",
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
  // Server-side proof that a human approved THIS order. Written only by the
  // authenticated approval path; a caller-supplied "approved" flag can no longer
  // stand in for it at the choke point. Nullable so legacy rows stay readable —
  // and, having no proof, stay unexecutable under user_approved.
  if (!intentCols.some((c) => c.name === "approved_at")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN approved_at INTEGER");
  }
  if (!intentCols.some((c) => c.name === "approved_by_user_id")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN approved_by_user_id INTEGER");
  }
  if (!intentCols.some((c) => c.name === "approval_consumed_at")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN approval_consumed_at INTEGER");
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
  // Structured payload for a `broker_action` intent (modify/cancel a pending
  // order, close a position by symbol) — never populated on a sized order.
  if (!intentCols.some((c) => c.name === "action_json")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN action_json TEXT");
  }
  if (!intentCols.some((c) => c.name === "recommendation_revision_no")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN recommendation_revision_no INTEGER");
  }
  if (!intentCols.some((c) => c.name === "authorization_source")) {
    db.exec("ALTER TABLE trade_intents ADD COLUMN authorization_source TEXT");
  }
  if (!tradeCols.some((c) => c.name === "limit_price")) {
    db.exec("ALTER TABLE trades ADD COLUMN limit_price REAL");
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

  if (!recCols.some((c) => c.name === "memory_refs_json")) {
    db.exec("ALTER TABLE recommendations ADD COLUMN memory_refs_json TEXT");
  }
  if (recCols.some((c) => c.name === "committee_json")) {
    db.exec("ALTER TABLE recommendations DROP COLUMN committee_json");
  }

  const auditCols = db
    .prepare("PRAGMA table_info(agent_audit_logs)")
    .all() as { name: string }[];
  if (auditCols.some((c) => c.name === "risk_veto")) {
    db.exec("ALTER TABLE agent_audit_logs DROP COLUMN risk_veto");
  }
  const runCols = db
    .prepare("PRAGMA table_info(agent_runs)")
    .all() as { name: string }[];
  if (runCols.some((c) => c.name === "risk_veto")) {
    db.exec("ALTER TABLE agent_runs DROP COLUMN risk_veto");
  }

  // Forward-only removal of the candle warehouse. The agent now reads every
  // candle live from the user's own MetaTrader account, every call, with no
  // server-side store or cache in between — this table's data is dropped,
  // not just stopped-growing.
  db.exec("DROP TABLE IF EXISTS market_candles");

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
  const semanticCols = db
    .prepare("PRAGMA table_info(semantic_memories)")
    .all() as { name: string }[];
  const semanticMigrations: Array<[string, string]> = [
    ["source", "TEXT NOT NULL DEFAULT 'agent'"],
    ["memory_type", "TEXT NOT NULL DEFAULT 'conversation_summary'"],
    ["confidence", "REAL NOT NULL DEFAULT 0.8"],
    ["safety_classification", "TEXT NOT NULL DEFAULT 'untrusted_content'"],
    ["expires_at", "TEXT"],
    ["last_used_at", "TEXT"],
    ["use_count", "INTEGER NOT NULL DEFAULT 0"],
    ["source_chat_id", "TEXT"],
    ["source_message_id", "TEXT"],
    ["source_recommendation_id", "TEXT"],
    ["source_trade_id", "TEXT"],
    ["locale", "TEXT"],
    ["symbol", "TEXT"],
    ["timeframe", "TEXT"],
    ["strategy_id", "TEXT"],
  ];
  for (const [name, definition] of semanticMigrations) {
    if (!semanticCols.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE semantic_memories ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_semantic_memories_recall
      ON semantic_memories (user_id, memory_type, symbol, timeframe, updated_at DESC);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, chat_id TEXT, session_id TEXT,
      request_id TEXT NOT NULL, symbol TEXT, timeframe TEXT, intent TEXT,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, cancelled_at INTEGER,
      decision TEXT, confidence REAL,
      error_code TEXT, feature_flags TEXT NOT NULL DEFAULT '{}', context_version TEXT,
      context_message_count INTEGER NOT NULL DEFAULT 0, recalled_memory_count INTEGER NOT NULL DEFAULT 0,
      skill_names TEXT NOT NULL DEFAULT '[]', tool_names TEXT NOT NULL DEFAULT '[]', token_usage TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs (user_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, user_id INTEGER NOT NULL,
      step_type TEXT NOT NULL, status TEXT NOT NULL, summary TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON agent_run_steps (run_id, id);
    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id INTEGER NOT NULL,
      tool_name TEXT NOT NULL, tool_version TEXT, permission TEXT, status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0, input_preview TEXT, output_preview TEXT,
      error_code TEXT, retry_count INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls (run_id, started_at);
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


  db.exec(`
    CREATE TABLE IF NOT EXISTS deep_analysis_runs (
      analysis_id            TEXT PRIMARY KEY,
      user_id                INTEGER NOT NULL,
      session_id             TEXT,
      chat_id                TEXT,
      message_id             TEXT,
      recommendation_id      INTEGER,
      recommendation_ref     TEXT,
      symbol                 TEXT NOT NULL,
      interval               TEXT NOT NULL,
      generation             INTEGER NOT NULL DEFAULT 1,
      research_job_id        TEXT,
      validation_job_id      TEXT,
      status                 TEXT NOT NULL,
      internal_progress      TEXT NOT NULL,
      ux_update_count        INTEGER NOT NULL DEFAULT 0,
      allow_reason           TEXT,
      failure_reason         TEXT,
      strategy_fingerprint   TEXT,
      result_projection_json TEXT,
      locale                 TEXT NOT NULL DEFAULT 'ar',
      created_at             INTEGER NOT NULL,
      updated_at             INTEGER NOT NULL,
      completed_at           INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_deep_analysis_user_session
      ON deep_analysis_runs (user_id, session_id, symbol, generation DESC);
    CREATE INDEX IF NOT EXISTS idx_deep_analysis_pending
      ON deep_analysis_runs (status, updated_at);
  `);

  db.exec(`
    UPDATE trades SET market = 'forex' WHERE market = 'crypto';
    UPDATE trade_intents SET market = 'forex' WHERE market = 'crypto';
    UPDATE recommendations SET market = 'forex' WHERE market = 'crypto';
    UPDATE trades SET broker = 'metaapi' WHERE broker = 'binance';
    UPDATE trade_intents SET broker = 'metaapi' WHERE broker = 'binance';
    DROP TABLE IF EXISTS binance_accounts;
  `);

  // Canonical matching keys (idempotent): strategy_deployments store XAUUSD/1h
  // while legacy recommendations kept broker suffixes (XAUUSDM) and timeframe
  // aliases (H1/60/1D) — those rows never matched deployment lookups, decay
  // tracking, or the execution-eligibility join. Forex symbols are 6 chars.
  db.exec(`
    UPDATE recommendations
       SET symbol = UPPER(SUBSTR(symbol, 1, 6))
     WHERE market = 'forex' AND LENGTH(symbol) > 6;
    UPDATE recommendations SET timeframe = '1m'  WHERE timeframe IN ('M1', '1');
    UPDATE recommendations SET timeframe = '5m'  WHERE timeframe IN ('M5', '5');
    UPDATE recommendations SET timeframe = '15m' WHERE timeframe IN ('M15', '15');
    UPDATE recommendations SET timeframe = '30m' WHERE timeframe IN ('M30', '30');
    UPDATE recommendations SET timeframe = '1h'  WHERE timeframe IN ('H1', '1H', '60');
    UPDATE recommendations SET timeframe = '4h'  WHERE timeframe IN ('H4', '4H', '240');
    UPDATE recommendations SET timeframe = '1d'  WHERE timeframe IN ('D1', '1D', 'D', '1440');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_entitlements (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_status TEXT NOT NULL DEFAULT 'trial',
      trial_interactions_used INTEGER NOT NULL DEFAULT 0,
      trial_in_flight INTEGER NOT NULL DEFAULT 0,
      trial_started_at TEXT,
      trial_recommendations_used INTEGER NOT NULL DEFAULT 0,
      subscription_expires_at TEXT,
      activated_at TEXT,
      activated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS trial_interaction_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      committed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trial_ledger_user
      ON trial_interaction_ledger(user_id, status);
  `);

  // Timed-trial columns (additive; existing rows keep a null clock until the
  // user's first MT link starts it).
  const entCols = db
    .prepare("PRAGMA table_info(user_entitlements)")
    .all()
    .map((c) => (c as { name: string }).name);
  if (!entCols.includes("trial_started_at")) {
    db.exec("ALTER TABLE user_entitlements ADD COLUMN trial_started_at TEXT");
  }
  if (!entCols.includes("trial_recommendations_used")) {
    db.exec(
      "ALTER TABLE user_entitlements ADD COLUMN trial_recommendations_used INTEGER NOT NULL DEFAULT 0",
    );
  }

  // Partial-stage outcomes on the case memory (plan §12). Additive only: rows
  // indexed before these columns existed keep NULLs — their features are
  // frozen and never reinterpreted.
  const marketCaseCols = db
    .prepare("PRAGMA table_info(market_cases)")
    .all() as { name: string }[];
  for (const [name, definition] of [
    ["break_level", "REAL"],
    ["break_direction", "TEXT"],
    ["forming_outcome", "TEXT"],
    ["forming_bars", "INTEGER"],
    ["false_break", "INTEGER"],
    ["early_net_r", "REAL"],
    ["confirmed_net_r", "REAL"],
    ["session_cost", "REAL"],
  ] as const) {
    if (!marketCaseCols.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE market_cases ADD COLUMN ${name} ${definition}`);
    }
  }

  const entFlag = db
    .prepare("SELECT value FROM system_flags WHERE key = 'entitlement_migration_v1'")
    .get() as { value?: string } | undefined;
  if (!entFlag) {
    db.exec(`
      INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at)
      SELECT u.id,
             CASE
               WHEN u.role = 'admin' THEN 'active'
               WHEN u.access_expires_at IS NOT NULL AND datetime(u.access_expires_at) > datetime('now') THEN 'active'
               WHEN u.access_expires_at IS NOT NULL AND datetime(u.access_expires_at) <= datetime('now') THEN 'expired'
               ELSE 'trial'
             END,
             0, 0,
             CASE WHEN u.role = 'admin' THEN NULL ELSE u.access_expires_at END
        FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM user_entitlements e WHERE e.user_id = u.id)
    `);
    db.prepare(
      `INSERT INTO system_flags (key, value) VALUES ('entitlement_migration_v1', 'applied')
       ON CONFLICT(key) DO NOTHING`,
    ).run();
  }

  // EA bridge retired. A stored 'ea' preference named a backend that no
  // longer exists — NULL defers to the deployment default (getForexBackend),
  // the same outcome resolveForexBackendFromPref already gives an
  // unrecognised value, so no one silently keeps routing through a backend
  // that isn't there.
  db.exec(`UPDATE trading_settings SET forex_backend = NULL WHERE forex_backend = 'ea'`);

  // Its tables carried nothing but hashed device tokens and heartbeat/candle
  // cache, none of which any code reads anymore.
  db.exec(`
    DROP TABLE IF EXISTS ea_commands;
    DROP TABLE IF EXISTS ea_market_cache;
    DROP TABLE IF EXISTS ea_connections;
  `);

  const mt5Doc = db
    .prepare("SELECT content_ar, content_en FROM dynamic_pages WHERE slug = ?")
    .get("docs-mt5-linking") as
    | { content_ar: string; content_en: string }
    | undefined;
  if (mt5Doc) {
    const stale = DOCS_MT5_LINKING_STALE_MARKERS.some(
      (m) => mt5Doc.content_ar.includes(m) || mt5Doc.content_en.includes(m),
    );
    if (stale) {
      db.prepare(
        "UPDATE dynamic_pages SET content_ar = ?, content_en = ? WHERE slug = ?",
      ).run(
        DOCS_MT5_LINKING_CONTENT_AR,
        DOCS_MT5_LINKING_CONTENT_EN,
        "docs-mt5-linking",
      );
    }
  }
}

export function seedAdminSqlite(db: Database.Database) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn(
      "[db] Admin bootstrap skipped: ADMIN_EMAIL and ADMIN_PASSWORD must both be configured.",
    );
    return;
  }
  const adminEmail = ADMIN_EMAIL.toLowerCase();
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(adminEmail) as { id: number } | undefined;

  if (existingAdmin) {
    db.prepare(
      "UPDATE users SET role = 'admin', status = 'active' WHERE id = ?",
    ).run(existingAdmin.id);
    db.prepare(
      "INSERT INTO trading_settings (user_id, per_trade_pct) VALUES (?, 1) ON CONFLICT (user_id) DO NOTHING",
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
  db.prepare(
    "INSERT INTO trading_settings (user_id, per_trade_pct) VALUES (?, 1)",
  ).run(userId);
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
  db.prepare(
    `INSERT INTO system_flags (key, value)
     VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_VERSION);
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
  const run = async (): Promise<T> => {
    const db = getSqliteDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(helpers);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const result = _transactionTail.then(run, run);
  _transactionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
