import { Pool, type PoolClient } from "pg";
import bcrypt from "bcryptjs";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../constants";
import {
  buildSupportContactPage,
  LEGACY_SEEDED_DYNAMIC_PAGE_SLUGS,
  migrateLegacyDynamicPageBranding,
  type DynamicPageBrandFields,
} from "./dynamicPageBranding";
import { adaptSql, normalizeRow } from "./sql";
import type { DbRow, ExecuteResult } from "./types";

let _pool: Pool | null = null;
const SCHEMA_VERSION = "2026-07-18-nav-admin-subscription-v1";

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

  CREATE TABLE IF NOT EXISTS trading_settings (
    user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    per_trade_pct            DOUBLE PRECISION NOT NULL DEFAULT 1
      CONSTRAINT trading_settings_per_trade_pct_valid CHECK (
        per_trade_pct >= 0.1
        AND per_trade_pct <= 5
        AND ABS(per_trade_pct * 10 - ROUND(per_trade_pct * 10)) < 0.000000001
      ),
    allowed_assets           TEXT NOT NULL DEFAULT '[]',
    -- 'ea' | 'mt5local' | NULL (operator's global default).
    forex_backend            TEXT,
    send_screenshot          BOOLEAN NOT NULL DEFAULT TRUE,
    telegram_chat_id         TEXT,
    onboarding_done          BOOLEAN NOT NULL DEFAULT FALSE,
    alerts_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    alert_trades             BOOLEAN NOT NULL DEFAULT TRUE,
    alert_signals            BOOLEAN NOT NULL DEFAULT TRUE,
    alert_push               BOOLEAN NOT NULL DEFAULT TRUE,
    -- Standing execution authorisation; the epoch pins an 'auto' grant to the
    -- connection it was given for. See the SQLite schema for the rationale.
    agent_trade_mode         TEXT NOT NULL DEFAULT 'unset',
    agent_trade_mode_updated_at BIGINT,
    agent_trade_mode_epoch   TEXT,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS admin_limits (
    user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    can_execute         BOOLEAN NOT NULL DEFAULT TRUE,
    claude_quota        INTEGER NOT NULL DEFAULT 1000,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_id     TEXT,
    session_id      TEXT,
    chat_id         TEXT,
    symbol          TEXT NOT NULL,
    action          TEXT NOT NULL,
    direction       TEXT,
    confidence      INTEGER NOT NULL DEFAULT 0,
    backtested_confidence DOUBLE PRECISION,
    confidence_low  DOUBLE PRECISION,
    confidence_high DOUBLE PRECISION,
    backtest_id     BIGINT,
    market_regime   TEXT,
    entry           DOUBLE PRECISION,
    stop_loss       DOUBLE PRECISION,
    take_profit     DOUBLE PRECISION,
    targets_json    TEXT NOT NULL DEFAULT '[]',
    risk_json       TEXT NOT NULL DEFAULT '{}',
    timeframe       TEXT,
    strategy_id     TEXT NOT NULL DEFAULT 'unspecified',
    strategy_version TEXT NOT NULL DEFAULT '1',
    expires_at      BIGINT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    status_reason   TEXT NOT NULL DEFAULT '',
    engine_version  TEXT NOT NULL DEFAULT 'legacy',
    entry_type      TEXT,
    legacy_tracking_id TEXT,
    updated_at      BIGINT,
    effective_revision_no INTEGER,
    plan_type       TEXT,
    execution_state TEXT,
    statistical_support TEXT,
    -- Where the decision's support came from, distinct from its grade above:
    -- direct_analysis | strategy_supported | historical_memory | deep_research.
    -- NULL on pre-existing rows; never backfilled with an implied source.
    evidence_source TEXT,
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
    -- Which revision of that recommendation this order was built from, and who
    -- authorised it. Both are checked again at execution time.
    recommendation_revision_no INTEGER,
    authorization_source TEXT,
    symbol            TEXT NOT NULL,
    side              TEXT NOT NULL,
    notional          DOUBLE PRECISION NOT NULL,
    market            TEXT NOT NULL DEFAULT 'forex',
    broker            TEXT NOT NULL DEFAULT 'mt_ea',
    entry             DOUBLE PRECISION,
    stop_loss         DOUBLE PRECISION,
    take_profit       DOUBLE PRECISION,
    confidence        INTEGER NOT NULL DEFAULT 0,
    rationale         TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    reason            TEXT,
    deny_code         TEXT,
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
    market      TEXT NOT NULL DEFAULT 'forex',
    broker      TEXT NOT NULL DEFAULT 'mt_ea',
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

  CREATE TABLE IF NOT EXISTS locks (
    name       TEXT PRIMARY KEY,
    holder     TEXT NOT NULL,
    expires_at BIGINT NOT NULL
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
    public_id  TEXT,
    title      TEXT NOT NULL DEFAULT 'محادثة جديدة',
    summary    TEXT,
    archived   BOOLEAN NOT NULL DEFAULT FALSE,
    workflow_state TEXT,
    workflow_context TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    metadata_json   TEXT,
    reasoning_summary TEXT,
    tool_calls_json TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS semantic_memories (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    category        TEXT NOT NULL,
    content         TEXT NOT NULL,
    embedding       vector(1536),
    archived        BOOLEAN NOT NULL DEFAULT FALSE,
    source          TEXT NOT NULL DEFAULT 'agent',
    memory_type     TEXT NOT NULL DEFAULT 'conversation_summary',
    confidence      DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    safety_classification TEXT NOT NULL DEFAULT 'untrusted_content',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    use_count       INTEGER NOT NULL DEFAULT 0,
    source_chat_id  TEXT,
    source_message_id TEXT,
    source_recommendation_id TEXT,
    source_trade_id TEXT,
    locale          TEXT,
    symbol          TEXT,
    timeframe       TEXT,
    strategy_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  -- One row per real change already announced; the unique key is what makes a
  -- re-run of the sweep silent. See the SQLite schema for the rationale.
  CREATE TABLE IF NOT EXISTS alert_dedupe (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dedupe_key  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    symbol      TEXT,
    created_at  BIGINT NOT NULL,
    UNIQUE (user_id, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS idx_alert_dedupe_recent
    ON alert_dedupe (user_id, created_at DESC);

  -- Browser/mobile push endpoints; see the SQLite schema for the rationale.
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  BIGINT NOT NULL,
    last_used_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON push_subscriptions (user_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id
    ON users (telegram_id) WHERE telegram_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS trade_lessons (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trade_id            INTEGER NOT NULL,
    recommendation_id   INTEGER,
    symbol              TEXT NOT NULL,
    market              TEXT NOT NULL DEFAULT 'forex',
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

  CREATE TABLE IF NOT EXISTS dynamic_pages (
    slug          TEXT PRIMARY KEY,
    title_ar      TEXT NOT NULL,
    title_en      TEXT NOT NULL,
    content_ar    TEXT NOT NULL,
    content_en    TEXT NOT NULL,
    is_published  BOOLEAN NOT NULL DEFAULT TRUE,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Candle Warehouse: server-side OANDA candle store. time = candle open (ms).
  CREATE TABLE IF NOT EXISTS market_candles (
    id         BIGSERIAL PRIMARY KEY,
    symbol     TEXT NOT NULL,
    interval   TEXT NOT NULL,
    time       BIGINT NOT NULL,
    open       DOUBLE PRECISION NOT NULL,
    high       DOUBLE PRECISION NOT NULL,
    low        DOUBLE PRECISION NOT NULL,
    close      DOUBLE PRECISION NOT NULL,
    volume     DOUBLE PRECISION NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'oanda',
    -- INTEGER (not BOOLEAN) on purpose: matches the codebase convention and
    -- lets execute() bind 1/0 uniformly across sqlite + pg. Read as != 0.
    complete   INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(symbol, interval, time, source)
  );

  CREATE INDEX IF NOT EXISTS idx_market_candles_lookup
    ON market_candles(symbol, interval, source, time);

  -- Historical case memory: one row per indexed market moment.
  -- Features come from candles at or before case_time; the outcome_* columns are
  -- computed from candles strictly after it. That split is the whole point, so
  -- the two groups are written by different functions and never mixed.
  CREATE TABLE IF NOT EXISTS market_cases (
    id              BIGSERIAL PRIMARY KEY,
    symbol          TEXT NOT NULL,
    interval        TEXT NOT NULL,
    case_time       BIGINT NOT NULL,
    direction       TEXT NOT NULL,
    regime          TEXT NOT NULL,
    trend           TEXT NOT NULL,
    range_zone      TEXT NOT NULL,
    pullback_depth  DOUBLE PRECISION NOT NULL,
    impulse_atr     DOUBLE PRECISION NOT NULL,
    volatility      DOUBLE PRECISION NOT NULL,
    session         TEXT NOT NULL,
    structure_run   INTEGER NOT NULL,
    pattern_name    TEXT,
    pattern_stage   TEXT,
    entry_price     DOUBLE PRECISION NOT NULL,
    atr             DOUBLE PRECISION NOT NULL,
    -- NULL while the forward window is still open (a case at the edge of the
    -- warehouse has no future yet); filled once the horizon is available.
    outcome         TEXT,
    outcome_bars    INTEGER,
    max_favourable  DOUBLE PRECISION,
    max_adverse     DOUBLE PRECISION,
    net_r           DOUBLE PRECISION,
    indexer_version INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(symbol, interval, case_time, direction, indexer_version)
  );

  -- Re-evaluation triggers (constitution §6). A trigger REQUESTS a new decision
  -- cycle; it never changes a plan. Recorded whether or not a cycle followed.
  CREATE TABLE IF NOT EXISTS recommendation_reevaluations (
    id                BIGSERIAL PRIMARY KEY,
    recommendation_id TEXT NOT NULL,
    user_id           INTEGER NOT NULL,
    symbol            TEXT NOT NULL,
    reason            TEXT NOT NULL,
    detail            TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL,
    revision_no       INTEGER,
    outcome           TEXT NOT NULL,
    raised_at         BIGINT NOT NULL,
    dedupe_key        TEXT NOT NULL,
    -- Fingerprint of the bundle the cycle decided on, so a confirmed verdict is
    -- traceable to the evidence that confirmed it.
    evidence_hash     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (recommendation_id, dedupe_key)
  );

  CREATE INDEX IF NOT EXISTS idx_recommendation_reevaluations_lookup
    ON recommendation_reevaluations(recommendation_id, raised_at DESC);

  -- Platform/MCP decision parity (plan §16, completion criterion 2). One row per
  -- surface per evidence bundle; two rows with the same evidence_hash are the
  -- only pair that is meaningfully comparable.
  CREATE TABLE IF NOT EXISTS decision_parity (
    id               BIGSERIAL PRIMARY KEY,
    evidence_hash    TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    timeframe_set    TEXT NOT NULL DEFAULT '[]',
    market_timestamp BIGINT NOT NULL,
    surface          TEXT NOT NULL,
    decision_json    TEXT NOT NULL DEFAULT '{}',
    created_at       BIGINT NOT NULL,
    UNIQUE (evidence_hash, surface)
  );

  CREATE INDEX IF NOT EXISTS idx_decision_parity_recent
    ON decision_parity(created_at DESC);

  -- Live spread samples per symbol×session (plan §13 H.1). Ten-minute samples
  -- from the EA's live quotes; aggregated on read, pruned past the window.
  CREATE TABLE IF NOT EXISTS cost_samples (
    id          BIGSERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    session     TEXT NOT NULL,
    spread_pips DOUBLE PRECISION NOT NULL,
    observed_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cost_samples_lookup
    ON cost_samples(symbol, observed_at);

  CREATE INDEX IF NOT EXISTS idx_market_cases_lookup
    ON market_cases(symbol, interval, regime, trend, direction);
  CREATE INDEX IF NOT EXISTS idx_market_cases_pending
    ON market_cases(symbol, interval, outcome, case_time);

  -- Smart Chart Agent decision audit (never stores raw model reasoning).
  CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id                              BIGSERIAL PRIMARY KEY,
    user_id                         INTEGER,
    request_id                      TEXT NOT NULL,
    session_id                      TEXT,
    symbol                          TEXT,
    interval                        TEXT,
    intent                          TEXT,
    decision                        TEXT,
    confidence                      DOUBLE PRECISION,
    news_risk                       TEXT,
    execution_requires_confirmation INTEGER NOT NULL DEFAULT 0,
    execution_confirmed             INTEGER NOT NULL DEFAULT 0,
    summary                         TEXT,
    metadata                        TEXT NOT NULL DEFAULT '{}',
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_user
    ON agent_audit_logs (user_id, id DESC);

  CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, chat_id TEXT, session_id TEXT,
    request_id TEXT NOT NULL, symbol TEXT, timeframe TEXT, intent TEXT,
    status TEXT NOT NULL, started_at BIGINT NOT NULL, completed_at BIGINT, cancelled_at BIGINT,
    decision TEXT, confidence DOUBLE PRECISION,
    error_code TEXT, feature_flags TEXT NOT NULL DEFAULT '{}', context_version TEXT,
    context_message_count INTEGER NOT NULL DEFAULT 0, recalled_memory_count INTEGER NOT NULL DEFAULT 0,
    skill_names TEXT NOT NULL DEFAULT '[]', tool_names TEXT NOT NULL DEFAULT '[]', token_usage TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs (user_id, started_at DESC);
  CREATE TABLE IF NOT EXISTS agent_run_steps (
    id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, step_type TEXT NOT NULL, status TEXT NOT NULL,
    summary TEXT, evidence_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON agent_run_steps (run_id, id);
  CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, tool_name TEXT NOT NULL, tool_version TEXT,
    permission TEXT, status TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
    input_preview TEXT, output_preview TEXT, error_code TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
    started_at BIGINT NOT NULL, completed_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls (run_id, started_at);

  CREATE TABLE IF NOT EXISTS agent_chats (
    id                   TEXT PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                TEXT NOT NULL DEFAULT 'محادثة جديدة',
    symbol               TEXT,
    interval             TEXT,
    language             TEXT NOT NULL DEFAULT 'ar',
    created_at           BIGINT NOT NULL,
    updated_at           BIGINT NOT NULL,
    last_message_preview TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_agent_chats_user
    ON agent_chats (user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS agent_chat_messages (
    id                TEXT PRIMARY KEY,
    chat_id           TEXT NOT NULL REFERENCES agent_chats(id) ON DELETE CASCADE,
    user_id           INTEGER NOT NULL,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL,
    result_json       TEXT,
    recommendation_id TEXT,
    analysis_id       TEXT,
    symbol            TEXT,
    interval          TEXT,
    created_at        BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_chat_messages_chat
    ON agent_chat_messages (chat_id, created_at);

  CREATE TABLE IF NOT EXISTS tracked_recommendations (
    id                  TEXT PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id             TEXT,
    analysis_id         TEXT,
    symbol              TEXT NOT NULL,
    interval            TEXT NOT NULL,
    direction           TEXT NOT NULL,
    entry_type          TEXT NOT NULL,
    entry               DOUBLE PRECISION NOT NULL,
    stop_loss           DOUBLE PRECISION NOT NULL,
    targets             TEXT NOT NULL DEFAULT '[]',
    invalidation_level  DOUBLE PRECISION,
    status              TEXT NOT NULL,
    outcome             TEXT NOT NULL DEFAULT 'pending',
    setup_type          TEXT,
    rr                  DOUBLE PRECISION,
    created_at          BIGINT NOT NULL,
    created_candle_time BIGINT NOT NULL,
    expires_at          BIGINT NOT NULL,
    triggered_at        BIGINT,
    tp1_hit_at          BIGINT,
    tp2_hit_at          BIGINT,
    tp3_hit_at          BIGINT,
    sl_hit_at           BIGINT,
    invalidated_at      BIGINT,
    cancelled_at        BIGINT,
    expired_at          BIGINT,
    price_at_creation   DOUBLE PRECISION,
    last_checked_at     BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_tracked_recs_user
    ON tracked_recommendations (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tracked_recs_outcome
    ON tracked_recommendations (outcome);

  CREATE TABLE IF NOT EXISTS recommendation_history (
    id BIGSERIAL PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, occurred_at BIGINT NOT NULL, actor TEXT NOT NULL,
    source TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_history_replay
    ON recommendation_history (user_id, recommendation_id, occurred_at, id);

  -- See the SQLite schema for the rationale: one revision is in force at a
  -- time, prior ones stay readable but stop being executable.
  CREATE TABLE IF NOT EXISTS recommendation_revisions (
    id BIGSERIAL PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL,
    direction TEXT NOT NULL, plan_type TEXT, execution_state TEXT,
    entry DOUBLE PRECISION, entry_low DOUBLE PRECISION, entry_high DOUBLE PRECISION,
    stop_loss DOUBLE PRECISION, targets_json TEXT NOT NULL DEFAULT '[]',
    activation_condition TEXT, invalidation_rule TEXT, alternative_scenario TEXT,
    validity_candles INTEGER, expires_at BIGINT,
    reason TEXT NOT NULL, source TEXT NOT NULL,
    evidence_hash TEXT, evidence_json TEXT NOT NULL DEFAULT '{}',
    decision_trace_json TEXT NOT NULL DEFAULT '{}',
    created_at BIGINT NOT NULL,
    UNIQUE (recommendation_id, revision_no)
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_revisions_lookup
    ON recommendation_revisions (user_id, recommendation_id, revision_no DESC);

  CREATE TABLE IF NOT EXISTS recommendation_transitions (
    id BIGSERIAL PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_status TEXT, to_status TEXT NOT NULL, occurred_at BIGINT NOT NULL,
    trigger_name TEXT NOT NULL, actor TEXT NOT NULL, source TEXT NOT NULL,
    reason TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_transitions_replay
    ON recommendation_transitions (user_id, recommendation_id, occurred_at, id);

  CREATE TABLE IF NOT EXISTS recommendation_outcomes (
    id BIGSERIAL PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outcome_type TEXT NOT NULL, target_index INTEGER, price DOUBLE PRECISION,
    r_multiple DOUBLE PRECISION, pnl DOUBLE PRECISION, holding_ms BIGINT,
    mae DOUBLE PRECISION, mfe DOUBLE PRECISION, spread_cost DOUBLE PRECISION,
    slippage DOUBLE PRECISION, commission DOUBLE PRECISION, risk_used DOUBLE PRECISION,
    occurred_at BIGINT NOT NULL, source TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT NOT NULL,
    UNIQUE (recommendation_id, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_outcomes_replay
    ON recommendation_outcomes (user_id, recommendation_id, occurred_at, id);

  CREATE TABLE IF NOT EXISTS recommendation_learning_events (
    event_id TEXT PRIMARY KEY,
    recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, occurred_at BIGINT NOT NULL, source_outcome_id BIGINT,
    payload_json TEXT NOT NULL DEFAULT '{}', evidence_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_learning_events_user
    ON recommendation_learning_events (user_id, event_type, occurred_at);

  CREATE TABLE IF NOT EXISTS strategy_backtests (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id TEXT NOT NULL, strategy_version TEXT NOT NULL DEFAULT '1',
    symbol TEXT NOT NULL, timeframe TEXT NOT NULL, job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', trade_count INTEGER NOT NULL DEFAULT 0,
    win_rate DOUBLE PRECISION, expectancy DOUBLE PRECISION, sharpe_ratio DOUBLE PRECISION,
    max_drawdown_pct DOUBLE PRECISION, profit_factor DOUBLE PRECISION,
    calibrated_confidence DOUBLE PRECISION, confidence_low DOUBLE PRECISION,
    confidence_high DOUBLE PRECISION, metrics_json TEXT NOT NULL DEFAULT '{}',
    validation_json TEXT NOT NULL DEFAULT '{}', error_message TEXT,
    created_at BIGINT NOT NULL, completed_at BIGINT, updated_at BIGINT NOT NULL,
    UNIQUE (user_id, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_strategy_backtests_lookup
    ON strategy_backtests (user_id, strategy_id, symbol, timeframe, status, completed_at);

  CREATE TABLE IF NOT EXISTS strategy_deployments (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
    backtest_id BIGINT NOT NULL REFERENCES strategy_backtests(id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'shadow', expected_win_rate DOUBLE PRECISION NOT NULL,
    calibrated_confidence DOUBLE PRECISION NOT NULL,
    confidence_low DOUBLE PRECISION NOT NULL, confidence_high DOUBLE PRECISION NOT NULL,
    live_sample_size INTEGER NOT NULL DEFAULT 0, live_win_rate DOUBLE PRECISION,
    suspended_reason TEXT, updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, strategy_id, symbol, timeframe)
  );
  CREATE INDEX IF NOT EXISTS idx_strategy_deployments_state
    ON strategy_deployments (user_id, state, strategy_id);

  CREATE TABLE IF NOT EXISTS trade_lesson_candidates (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL, recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'candidate', reason TEXT NOT NULL,
    evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', strategy_id TEXT NOT NULL,
    market TEXT NOT NULL, confidence DOUBLE PRECISION NOT NULL,
    affected_symbols_json TEXT NOT NULL DEFAULT '[]', sample_size INTEGER NOT NULL,
    created_at BIGINT NOT NULL, validated_at BIGINT,
    UNIQUE (user_id, fingerprint)
  );

  CREATE TABLE IF NOT EXISTS gold_agent_weight_versions (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    strategy_id TEXT NOT NULL, version INTEGER NOT NULL, parent_version INTEGER,
    weights_json TEXT NOT NULL, sample_size INTEGER NOT NULL,
    confidence DOUBLE PRECISION NOT NULL, decay DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate', evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL, activated_at BIGINT, rolled_back_at BIGINT,
    UNIQUE (user_id, strategy_id, version)
  );

  CREATE TABLE IF NOT EXISTS trading_dna_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, generated_at BIGINT NOT NULL,
    window_start BIGINT, window_end BIGINT, sample_size INTEGER NOT NULL,
    metrics_json TEXT NOT NULL DEFAULT '[]', conclusions_json TEXT NOT NULL DEFAULT '[]',
    evidence_json TEXT NOT NULL DEFAULT '{}', UNIQUE (user_id, version)
  );
  CREATE INDEX IF NOT EXISTS idx_trading_dna_snapshots_user
    ON trading_dna_snapshots (user_id, version DESC);

  CREATE TABLE IF NOT EXISTS trading_persona_versions (
    persona_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES trading_dna_snapshots(snapshot_id) ON DELETE CASCADE,
    persona TEXT NOT NULL, confidence DOUBLE PRECISION NOT NULL,
    sample_size INTEGER NOT NULL, rationale TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL,
    UNIQUE (user_id, version), UNIQUE (user_id, snapshot_id)
  );

  CREATE TABLE IF NOT EXISTS shadow_recommendations (
    shadow_recommendation_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_id TEXT NOT NULL REFERENCES trading_dna_snapshots(snapshot_id) ON DELETE CASCADE,
    source_recommendation_id INTEGER REFERENCES recommendations(id) ON DELETE SET NULL,
    symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('buy','sell','wait')),
    confidence DOUBLE PRECISION NOT NULL,
    rationale_json TEXT NOT NULL DEFAULT '[]', evidence_json TEXT NOT NULL DEFAULT '{}',
    research_only INTEGER NOT NULL DEFAULT 1 CHECK (research_only = 1),
    execution_prohibited INTEGER NOT NULL DEFAULT 1 CHECK (execution_prohibited = 1),
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shadow_recommendations_user
    ON shadow_recommendations (user_id, created_at DESC);

  CREATE OR REPLACE FUNCTION reject_recommendation_history_update()
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'recommendation evidence is append-only';
  END;
  $$ LANGUAGE plpgsql;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_recommendation_history_update') THEN
      CREATE TRIGGER immutable_recommendation_history_update
        BEFORE UPDATE ON recommendation_history
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_recommendation_revisions_update') THEN
      CREATE TRIGGER immutable_recommendation_revisions_update
        BEFORE UPDATE ON recommendation_revisions
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_recommendation_transitions_update') THEN
      CREATE TRIGGER immutable_recommendation_transitions_update
        BEFORE UPDATE ON recommendation_transitions
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_recommendation_outcomes_update') THEN
      CREATE TRIGGER immutable_recommendation_outcomes_update
        BEFORE UPDATE ON recommendation_outcomes
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_recommendation_learning_events_update') THEN
      CREATE TRIGGER immutable_recommendation_learning_events_update
        BEFORE UPDATE ON recommendation_learning_events
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_trading_dna_snapshots_update') THEN
      CREATE TRIGGER immutable_trading_dna_snapshots_update
        BEFORE UPDATE ON trading_dna_snapshots
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_trading_persona_versions_update') THEN
      CREATE TRIGGER immutable_trading_persona_versions_update
        BEFORE UPDATE ON trading_persona_versions
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'immutable_shadow_recommendations_update') THEN
      CREATE TRIGGER immutable_shadow_recommendations_update
        BEFORE UPDATE ON shadow_recommendations
        FOR EACH ROW EXECUTE FUNCTION reject_recommendation_history_update();
    END IF;
  END $$;
`;

async function migratePg(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS dynamic_pages (
      slug          TEXT PRIMARY KEY,
      title_ar      TEXT NOT NULL,
      title_en      TEXT NOT NULL,
      content_ar    TEXT NOT NULL,
      content_en    TEXT NOT NULL,
      is_published  BOOLEAN NOT NULL DEFAULT TRUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
      content_ar: "# سياسة الخصوصية\n\nنحن في **AiChart** نلتزم بحماية خصوصيتك وأمان بياناتك المالية والشخصية.\n\n### 1. جمع المعلومات\nنقوم بجمع المعلومات اللازمة فقط لربط حسابات التداول الخاصة بك وتنفيذ صفقاتك بأمان. لا نقوم بمشاركة أي بيانات سرية مع أي طرف ثالث.\n\n### 2. حماية البيانات\nيتم تشفير جميع مفاتيح API وكلمات المرور الخاصة بك باستخدام خوارزميات تشفير متقدمة على مستوى الخادم.",
      content_en: "# Privacy Policy\n\nAt **AiChart**, we are committed to protecting your privacy and the security of your financial and personal data.\n\n### 1. Data Collection\nWe collect only the information necessary to connect your trading accounts and execute trades securely. We never share sensitive data with third parties.\n\n### 2. Data Protection\nAll API keys and passwords are encrypted using state-of-the-art server-side encryption algorithms."
    },
    {
      slug: "terms-of-service",
      title_ar: "الشروط والأحكام",
      title_en: "Terms of Service",
      content_ar: "# الشروط والأحكام\n\nمرحباً بك في منصة **AiChart**. باستخدامك لخدماتنا، فإنك توافق على الالتزام بالشروط التالية.\n\n### 1. شروط الاستخدام\nيجب أن تكون مؤهلاً قانونياً للتداول واستخدام منصات التداول. المنصة تقدم خدمات اتخاذ القرارات والربط البرمجي فقط.\n\n### 2. المسؤولية\nأنت مسؤول بشكل كامل عن الصفقات والقرارات التي يتم تنفيذها من خلال المنصة.",
      content_en: "# Terms of Service\n\nWelcome to **AiChart**. By using our services, you agree to comply with the following terms.\n\n### 1. Conditions of Use\nYou must be legally eligible to trade and use financial platforms. The platform provides decision support and programmatic connectivity only.\n\n### 2. Liability\nYou are fully responsible for the trades and decisions executed through the platform."
    },
    {
      slug: "user-agreement",
      title_ar: "اتفاقية الاستخدام",
      title_en: "User Agreement",
      content_ar: "# اتفاقية الاستخدام\n\nتوضح هذه الاتفاقية الحقوق والالتزامات المتبادلة بين المستخدم ومنصة **AiChart**.\n\n### 1. ترخيص الخدمة\nتمنحك المنصة ترخيصاً محدداً وغير حصري للوصول إلى أدوات تحليل البيانات ووكيل التداول الذكي.\n\n### 2. الحسابات والاشتراكات\nيجب الحفاظ على سرية معلومات الدخول والتحقق الثنائي لضمان أمان حسابك.",
      content_en: "# User Agreement\n\nThis agreement outlines the mutual rights and obligations between the user and the **AiChart** platform.\n\n### 1. Service License\nThe platform grants you a limited, non-exclusive license to access data analysis tools and the smart trading agent.\n\n### 2. Accounts and Subscriptions\nCredentials and two-factor authentication parameters must be kept confidential to ensure account safety."
    },
    {
      slug: "risk-disclosure",
      title_ar: "إخلاء المسؤولية عن مخاطر التداول",
      title_en: "Risk Disclosure",
      content_ar: "# إخلاء المسؤولية عن مخاطر التداول\n\n> [!WARNING]\n> التداول في أسواق الفوركس والرافعة المالية ينطوي على مخاطر خسارة مالية كبيرة.\n\n### 1. مخاطر السوق\nالأسعار متقلبة بشكل كبير والرافعة المالية قد تضاعف الخسائر كما تضاعف الأرباح.\n\n### 2. عدم وجود ضمانات\nلا تقدم منصة **AiChart** أي ضمانات بتحقيق أرباح. الأداء السابق لا يضمن الأداء المستقبلي.",
      content_en: "# Risk Disclosure\n\n> [!WARNING]\n> Trading in forex and leveraged markets carries significant risk of financial loss.\n\n### 1. Market Risks\nPrices are highly volatile, and leverage can multiply losses just as it multiplies profits.\n\n### 2. No Guarantees\nThe **AiChart** platform makes no guarantees of profits. Past performance does not guarantee future results."
    },
    {
      slug: "about-us",
      title_ar: "من نحن",
      title_en: "About Us",
      content_ar: "# من نحن\n\n**AiChart** هي منصة متكاملة تجمع بين أدوات تحليل الشارتات المتقدمة ووكيل الذكاء الاصطناعي الذكي لتوجيه صفقاتك بنقرة واحدة.\n\n### رؤيتنا\nتمكين المتداولين الأفراد من استخدام أدوات تداول مؤسساتية تعتمد على الذكاء الاصطناعي لإدارة المخاطر وتحسين الأداء.",
      content_en: "# About Us\n\n**AiChart** is an integrated platform combining advanced charting tools and an intelligent AI agent to guide your trades in a single click.\n\n### Our Vision\nEmpowering retail traders to use institutional-grade AI-powered trading tools to manage risk and optimize performance."
    },
    {
      slug: "blog",
      title_ar: "المدونة الرسمية",
      title_en: "Official Blog",
      content_ar: "# المدونة الرسمية لمنصة AiChart\n\nتابع أحدث مقالاتنا وتحليلات السوق وتحديثات الذكاء الاصطناعي.\n\n- **كيف يعمل التداول الآلي بالذكاء الاصطناعي؟**\n- **استراتيجيات إدارة المخاطر وتجنب التصفية.**\n- **التحديثات الأخيرة لوكلاء التداول وكتابة السيناريوهات.**",
      content_en: "# AiChart Official Blog\n\nFollow our latest articles, market analysis, and AI updates.\n\n- **How AI-Assisted Trading Works?**\n- **Risk Management Strategies and Avoiding Liquidation.**\n- **Latest Updates on Trading Agents and Scripting.**"
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
    await client.query(`
      INSERT INTO dynamic_pages (slug, title_ar, title_en, content_ar, content_en, is_published, metadata_json)
      VALUES ($1, $2, $3, $4, $5, TRUE, '{}')
      ON CONFLICT (slug) DO NOTHING
    `, [page.slug, page.title_ar, page.title_en, page.content_ar, page.content_en]).catch(() => {});
  }

  const legacyPages = await client.query(
    `SELECT slug, title_ar, title_en, content_ar, content_en, metadata_json
       FROM dynamic_pages
      WHERE slug = ANY($1::text[])`,
    [[...LEGACY_SEEDED_DYNAMIC_PAGE_SLUGS]],
  );
  for (const current of legacyPages.rows as DynamicPageBrandFields[]) {
    const migrated = migrateLegacyDynamicPageBranding(current, supportContacts);
    if (!migrated.changed) continue;
    await client.query(
      `UPDATE dynamic_pages
          SET title_ar = $1,
              title_en = $2,
              content_ar = $3,
              content_en = $4,
              metadata_json = $5,
              updated_at = NOW()
        WHERE slug = $6`,
      [
        migrated.page.title_ar,
        migrated.page.title_en,
        migrated.page.content_ar,
        migrated.page.content_en,
        migrated.page.metadata_json,
        migrated.page.slug,
      ],
    );
  }

  // HNSW requires a fixed dimension. Older deployments created the column as a
  // dimensionless `vector`; coerce it to vector(1536) (all stored embeddings are
  // 1536-dim) so the ANN index below can be built.
  await client
    .query(
      `ALTER TABLE semantic_memories ALTER COLUMN embedding TYPE vector(1536)`,
    )
    .catch(() => {
      /* already vector(1536), empty, or extension missing — index step will warn */
    });

  // ANN indexes for semantic/trade memory similarity. Without these, cosine
  // search sequentially scans every row in a user's partition, which degrades
  // as memory grows. HNSW (pgvector >= 0.5) gives sub-linear cosine lookups.
  await client
    .query(
      `CREATE INDEX IF NOT EXISTS idx_semantic_memories_embedding_hnsw
       ON semantic_memories USING hnsw (embedding vector_cosine_ops)`,
    )
    .catch((err) => {
      console.warn("[db] semantic_memories HNSW index skipped:", err.message);
    });
  await client
    .query(
      `CREATE INDEX IF NOT EXISTS idx_trade_lessons_embedding_hnsw
       ON trade_lessons USING hnsw (embedding vector_cosine_ops)`,
    )
    .catch((err) => {
      console.warn("[db] trade_lessons HNSW index skipped:", err.message);
    });

  await client.query(`
    UPDATE platform_config SET plain = TRUE
    WHERE plain = FALSE
      AND key IN (
        'ANTHROPIC_MODEL',
        'TELEGRAM_BOT_USERNAME',
        'APP_URL',
        'METAAPI_REGION'
      )
  `).catch(() => {
    /* table may be empty on first boot */
  });

  // Surviving user preferences. Trading decisions are model-owned; only the
  // account-risk percentage remains as a trading input.
  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS alerts_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS alert_push            BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS agent_trade_mode      TEXT NOT NULL DEFAULT 'unset',
      ADD COLUMN IF NOT EXISTS agent_trade_mode_updated_at BIGINT,
      ADD COLUMN IF NOT EXISTS agent_trade_mode_epoch TEXT,
      ADD COLUMN IF NOT EXISTS alert_trades          BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS alert_signals         BOOLEAN NOT NULL DEFAULT TRUE
  `).catch(() => {
    /* table may not exist yet on first boot */
  });

  await client.query(`
    ALTER TABLE trading_settings
      ADD COLUMN IF NOT EXISTS forex_backend TEXT
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS oco_order_list_id TEXT
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'forex',
      ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT 'mt_ea'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trade_intents
      ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'forex',
      ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT 'mt_ea'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trades
      ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'spot',
      ADD COLUMN IF NOT EXISTS leverage DOUBLE PRECISION NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'market'
  `).catch(() => {});

  await client.query(`
    ALTER TABLE trade_intents
      ADD COLUMN IF NOT EXISTS deny_code TEXT,
      ADD COLUMN IF NOT EXISTS recommendation_revision_no INTEGER,
      ADD COLUMN IF NOT EXISTS authorization_source TEXT
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
    ALTER TABLE recommendations
      ADD COLUMN IF NOT EXISTS chart_drawings_json TEXT,
      ADD COLUMN IF NOT EXISTS pattern_name TEXT,
      ADD COLUMN IF NOT EXISTS analysis_tier TEXT,
      ADD COLUMN IF NOT EXISTS context_json TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web',
      ADD COLUMN IF NOT EXISTS market TEXT,
      ADD COLUMN IF NOT EXISTS analysis_id TEXT,
      ADD COLUMN IF NOT EXISTS session_id TEXT,
      ADD COLUMN IF NOT EXISTS chat_id TEXT,
      ADD COLUMN IF NOT EXISTS direction TEXT,
      ADD COLUMN IF NOT EXISTS targets_json TEXT NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS risk_json TEXT NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS strategy_id TEXT NOT NULL DEFAULT 'unspecified',
      ADD COLUMN IF NOT EXISTS strategy_version TEXT NOT NULL DEFAULT '1',
      ADD COLUMN IF NOT EXISTS backtested_confidence DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS confidence_low DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS confidence_high DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS backtest_id BIGINT,
      ADD COLUMN IF NOT EXISTS market_regime TEXT,
      ADD COLUMN IF NOT EXISTS expires_at BIGINT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS status_reason TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS engine_version TEXT NOT NULL DEFAULT 'legacy',
      ADD COLUMN IF NOT EXISTS entry_type TEXT,
      ADD COLUMN IF NOT EXISTS legacy_tracking_id TEXT,
      ADD COLUMN IF NOT EXISTS updated_at BIGINT,
      ADD COLUMN IF NOT EXISTS effective_revision_no INTEGER,
      ADD COLUMN IF NOT EXISTS plan_type TEXT,
      ADD COLUMN IF NOT EXISTS execution_state TEXT,
      ADD COLUMN IF NOT EXISTS statistical_support TEXT,
      ADD COLUMN IF NOT EXISTS evidence_source TEXT
  `).catch(() => {});
  await client.query(`
    UPDATE recommendations
       SET direction = COALESCE(direction, action),
           targets_json = CASE
             WHEN targets_json IS NULL OR targets_json = '[]'
             THEN CASE WHEN take_profit IS NULL THEN '[]' ELSE '[' || take_profit::text || ']' END
             ELSE targets_json END,
           status = CASE
             WHEN status IS NULL OR status = 'draft'
             THEN CASE
               WHEN action IN ('buy','sell') AND entry IS NOT NULL AND stop_loss IS NOT NULL AND take_profit IS NOT NULL
               THEN 'active' ELSE COALESCE(status, 'draft') END
             ELSE status END,
           expires_at = COALESCE(expires_at, ((EXTRACT(EPOCH FROM NOW()) + 14400) * 1000)::BIGINT),
           updated_at = COALESCE(updated_at, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
  `).catch(() => {});
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendations_legacy_tracking
      ON recommendations (user_id, legacy_tracking_id)
      WHERE legacy_tracking_id IS NOT NULL
  `).catch(() => {});
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_recommendations_lifecycle
      ON recommendations (user_id, status, created_at DESC)
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
      ADD COLUMN IF NOT EXISTS memory_refs_json TEXT,
      DROP COLUMN IF EXISTS committee_json
  `).catch(() => {});
  await client.query(`
    ALTER TABLE agent_audit_logs DROP COLUMN IF EXISTS risk_veto;
    ALTER TABLE agent_runs DROP COLUMN IF EXISTS risk_veto
  `).catch(() => {});

  // Forward-only removal of the configurable decision-policy era. Historical
  // recommendations/trades remain intact; obsolete preference columns do not.
  await client.query(`
    ALTER TABLE trading_settings
      DROP COLUMN IF EXISTS mode,
      DROP COLUMN IF EXISTS approval,
      DROP COLUMN IF EXISTS experience,
      DROP COLUMN IF EXISTS style,
      DROP COLUMN IF EXISTS max_capital,
      DROP COLUMN IF EXISTS max_open_trades,
      DROP COLUMN IF EXISTS daily_profit_target_pct,
      DROP COLUMN IF EXISTS daily_profit_target_usd,
      DROP COLUMN IF EXISTS daily_loss_limit_pct,
      DROP COLUMN IF EXISTS monthly_loss_limit_pct,
      DROP COLUMN IF EXISTS auto_take_profit_usd,
      DROP COLUMN IF EXISTS kill_switch,
      DROP COLUMN IF EXISTS risk_guard_enabled,
      DROP COLUMN IF EXISTS alert_min_confidence,
      DROP COLUMN IF EXISTS min_confidence,
      DROP COLUMN IF EXISTS min_rr,
      DROP COLUMN IF EXISTS trading_style,
      DROP COLUMN IF EXISTS scalp_max_trades,
      DROP COLUMN IF EXISTS scalp_enabled,
      DROP COLUMN IF EXISTS scalp_execution_mode,
      DROP COLUMN IF EXISTS futures_enabled,
      DROP COLUMN IF EXISTS default_leverage,
      DROP COLUMN IF EXISTS last_manual_scan_at,
      DROP COLUMN IF EXISTS scan_poll_minutes,
      DROP COLUMN IF EXISTS analysis_interval,
      DROP COLUMN IF EXISTS execution_env_preference,
      DROP COLUMN IF EXISTS active_market
  `).catch((err) => {
    console.warn("[db] obsolete trading settings cleanup skipped:", err.message);
  });
  await client.query(`
    ALTER TABLE admin_limits
      DROP COLUMN IF EXISTS max_capital_cap,
      DROP COLUMN IF EXISTS max_open_trades_cap,
      DROP COLUMN IF EXISTS max_leverage_cap
  `).catch((err) => {
    console.warn("[db] obsolete admin policy cleanup skipped:", err.message);
  });
  await client.query(`
    UPDATE trading_settings
       SET per_trade_pct = CASE
         WHEN per_trade_pct IS NULL
           OR per_trade_pct < 0.1
           OR per_trade_pct > 5
         THEN 1
         ELSE ROUND(per_trade_pct::NUMERIC, 1)::DOUBLE PRECISION
       END
  `);
  await client.query(`
    ALTER TABLE trading_settings
      ALTER COLUMN per_trade_pct SET DEFAULT 1,
      ALTER COLUMN per_trade_pct SET NOT NULL,
      DROP CONSTRAINT IF EXISTS trading_settings_per_trade_pct_valid,
      ADD CONSTRAINT trading_settings_per_trade_pct_valid CHECK (
        per_trade_pct >= 0.1
        AND per_trade_pct <= 5
        AND ABS(per_trade_pct * 10 - ROUND(per_trade_pct * 10)) < 0.000000001
      )
  `);

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
    CREATE TABLE IF NOT EXISTS trade_lessons (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_id            INTEGER NOT NULL,
      recommendation_id   INTEGER,
      symbol              TEXT NOT NULL,
      market              TEXT NOT NULL DEFAULT 'forex',
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

  const dupTokens = await client.query<{ token_hash: string }>(
    `SELECT token_hash FROM ea_connections
     GROUP BY token_hash HAVING COUNT(*) > 1 LIMIT 1`,
  ).catch(() => ({ rows: [] as { token_hash: string }[] }));

  if (dupTokens.rows.length === 0) {
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ea_connections_token_unique
        ON ea_connections (token_hash)
    `).catch((err) => {
      console.warn("[db] ea_connections token_hash unique index:", err);
    });
  } else {
    console.warn(
      "[db] duplicate ea_connections.token_hash — skipping unique index",
    );
  }

  // AI Agent Memory Architecture migrations
  await client.query(`
    ALTER TABLE chat_messages
      ADD COLUMN IF NOT EXISTS reasoning_summary TEXT,
      ADD COLUMN IF NOT EXISTS tool_calls_json TEXT
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS semantic_memories (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
      category        TEXT NOT NULL,
      content         TEXT NOT NULL,
      embedding       vector,
      archived        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_semantic_memories_user ON semantic_memories (user_id, category)
  `).catch(() => {});

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_semantic_memories_archive ON semantic_memories (archived)
  `).catch(() => {});

  await client.query(`
    ALTER TABLE semantic_memories
      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent',
      ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'conversation_summary',
      ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
      ADD COLUMN IF NOT EXISTS safety_classification TEXT NOT NULL DEFAULT 'untrusted_content',
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source_chat_id TEXT,
      ADD COLUMN IF NOT EXISTS source_message_id TEXT,
      ADD COLUMN IF NOT EXISTS source_recommendation_id TEXT,
      ADD COLUMN IF NOT EXISTS source_trade_id TEXT,
      ADD COLUMN IF NOT EXISTS locale TEXT,
      ADD COLUMN IF NOT EXISTS symbol TEXT,
      ADD COLUMN IF NOT EXISTS timeframe TEXT,
      ADD COLUMN IF NOT EXISTS strategy_id TEXT
  `).catch(() => {});

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_semantic_memories_recall
      ON semantic_memories (user_id, memory_type, symbol, timeframe, updated_at DESC)
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, chat_id TEXT, session_id TEXT,
      request_id TEXT NOT NULL, symbol TEXT, timeframe TEXT, intent TEXT,
      status TEXT NOT NULL, started_at BIGINT NOT NULL, completed_at BIGINT, cancelled_at BIGINT,
      decision TEXT, confidence DOUBLE PRECISION,
      error_code TEXT, feature_flags TEXT NOT NULL DEFAULT '{}', context_version TEXT,
      context_message_count INTEGER NOT NULL DEFAULT 0, recalled_memory_count INTEGER NOT NULL DEFAULT 0,
      skill_names TEXT NOT NULL DEFAULT '[]', tool_names TEXT NOT NULL DEFAULT '[]', token_usage TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs (user_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL, step_type TEXT NOT NULL, status TEXT NOT NULL,
      summary TEXT, evidence_json TEXT NOT NULL DEFAULT '{}', created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON agent_run_steps (run_id, id);
    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL, tool_name TEXT NOT NULL, tool_version TEXT, permission TEXT,
      status TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, input_preview TEXT,
      output_preview TEXT, error_code TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
      started_at BIGINT NOT NULL, completed_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls (run_id, started_at)
  `).catch(() => {});

  // AI Copilot state & events migrations
  await client.query(`
    ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS workflow_state TEXT,
      ADD COLUMN IF NOT EXISTS workflow_context TEXT
  `).catch(() => {});

  // Opaque public id (slug) for non-enumerable conversation URLs.
  await client.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS public_id TEXT
  `).catch(() => {});
  // Backfill existing rows lacking a slug (14-char hex). Uses md5 of random +
  // id so it needs no pgcrypto extension; id keeps it collision-free.
  await client.query(`
    UPDATE conversations
    SET public_id = substr(md5(random()::text || '-' || id::text), 1, 14)
    WHERE public_id IS NULL
  `).catch(() => {});
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_public_id
      ON conversations (public_id)
  `).catch(() => {});

  // Per-user chart layouts (TradingView-style /chart/<id> URLs + saved drawings).
  await client.query(`
    CREATE TABLE IF NOT EXISTS chart_layouts (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol     TEXT NOT NULL DEFAULT 'EURUSD',
      interval   TEXT NOT NULL DEFAULT '15m',
      state_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_chart_layouts_user ON chart_layouts(user_id)",
  ).catch(() => {});

  // Subscription entitlements + account-wide trial interaction ledger.
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_entitlements (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_status TEXT NOT NULL DEFAULT 'trial',
      trial_interactions_used INTEGER NOT NULL DEFAULT 0,
      trial_in_flight INTEGER NOT NULL DEFAULT 0,
      subscription_expires_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ,
      activated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await client.query(`
    CREATE TABLE IF NOT EXISTS trial_interaction_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      committed_at TIMESTAMPTZ
    )
  `).catch(() => {});
  await client.query(
    "CREATE INDEX IF NOT EXISTS idx_trial_ledger_user ON trial_interaction_ledger(user_id, status)",
  ).catch(() => {});

  // Idempotent entitlement backfill (counts only; no private payloads).
  const entFlag = await client.query(
    `SELECT value FROM system_flags WHERE key = 'entitlement_migration_v1'`,
  );
  if (entFlag.rowCount === 0) {
    await client.query(`
      INSERT INTO user_entitlements (user_id, plan_status, trial_interactions_used, trial_in_flight, subscription_expires_at)
      SELECT u.id,
             CASE
               WHEN u.role = 'admin' THEN 'active'
               WHEN u.access_expires_at IS NOT NULL AND u.access_expires_at > NOW() THEN 'active'
               WHEN u.access_expires_at IS NOT NULL AND u.access_expires_at <= NOW() THEN 'expired'
               ELSE 'trial'
             END,
             0, 0,
             CASE WHEN u.role = 'admin' THEN NULL ELSE u.access_expires_at END
        FROM users u
      ON CONFLICT (user_id) DO NOTHING
    `).catch((err) => {
      console.warn("[db] entitlement backfill skipped:", err.message);
    });
    await client.query(
      `INSERT INTO system_flags (key, value) VALUES ('entitlement_migration_v1', 'applied')
       ON CONFLICT (key) DO NOTHING`,
    ).catch(() => {});
  }


  await client.query(`
    UPDATE trades SET market = 'forex' WHERE market = 'crypto'
  `).catch(() => {});
  await client.query(`
    UPDATE trade_intents SET market = 'forex' WHERE market = 'crypto'
  `).catch(() => {});
  await client.query(`
    UPDATE recommendations SET market = 'forex' WHERE market = 'crypto'
  `).catch(() => {});
  await client.query(`
    UPDATE trades SET broker = 'mt_ea' WHERE broker = 'binance'
  `).catch(() => {});
  await client.query(`
    UPDATE trade_intents SET broker = 'mt_ea' WHERE broker = 'binance'
  `).catch(() => {});
  await client.query(`DROP TABLE IF EXISTS binance_accounts CASCADE`).catch(() => {});

  // Canonical matching keys (idempotent): strategy_deployments store XAUUSD/1h
  // while legacy recommendations kept broker suffixes (XAUUSDM) and timeframe
  // aliases (H1/60/1D) — those rows never matched deployment lookups, decay
  // tracking, or the execution-eligibility join. Forex symbols are 6 chars.
  await client.query(`
    UPDATE recommendations
       SET symbol = UPPER(SUBSTRING(symbol FROM 1 FOR 6))
     WHERE market = 'forex' AND LENGTH(symbol) > 6
  `).catch(() => {});
  await client.query(`
    UPDATE recommendations SET timeframe = CASE
      WHEN timeframe IN ('M1', '1') THEN '1m'
      WHEN timeframe IN ('M5', '5') THEN '5m'
      WHEN timeframe IN ('M15', '15') THEN '15m'
      WHEN timeframe IN ('M30', '30') THEN '30m'
      WHEN timeframe IN ('H1', '1H', '60') THEN '1h'
      WHEN timeframe IN ('H4', '4H', '240') THEN '4h'
      WHEN timeframe IN ('D1', '1D', 'D', '1440') THEN '1d'
      ELSE timeframe
    END
    WHERE timeframe IN ('M1','1','M5','5','M15','15','M30','30','H1','1H','60','H4','4H','240','D1','1D','D','1440')
  `).catch(() => {});

  await client.query(`
    CREATE TABLE IF NOT EXISTS deep_analysis_runs (
      analysis_id            TEXT PRIMARY KEY,
      user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
      created_at             BIGINT NOT NULL,
      updated_at             BIGINT NOT NULL,
      completed_at           BIGINT
    )
  `).catch(() => {});
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_deep_analysis_user_session
      ON deep_analysis_runs (user_id, session_id, symbol, generation DESC)
  `).catch(() => {});
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_deep_analysis_pending
      ON deep_analysis_runs (status, updated_at)
  `).catch(() => {});
}

async function seedAdminPg(client: PoolClient) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn(
      "[db] Admin bootstrap skipped: ADMIN_EMAIL and ADMIN_PASSWORD must both be configured.",
    );
    return;
  }
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
      "INSERT INTO trading_settings (user_id, per_trade_pct) VALUES ($1, 1) ON CONFLICT (user_id) DO NOTHING",
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
  await client.query(
    "INSERT INTO trading_settings (user_id, per_trade_pct) VALUES ($1, 1)",
    [userId],
  );
  await client.query(
    "INSERT INTO admin_limits (user_id, can_execute) VALUES ($1, TRUE)",
    [userId],
  );
  console.warn(
    `[db] Bootstrapped admin account "${ADMIN_EMAIL}". Change the password after first login.`,
  );
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for PostgreSQL");
  // Tuned for many concurrent app/worker instances behind one Postgres (or a
  // PgBouncer pooler). Cap connections per process so N replicas don't exhaust
  // server slots; bound waits so a saturated pool fails fast instead of hanging.
  const sslRequired =
    process.env.PGSSL === "1" ||
    process.env.PGSSLMODE === "require" ||
    /[?&]sslmode=require/.test(url);
  // Verify the server certificate by default; only skip verification when the
  // operator explicitly opts in (e.g. self-signed dev DB) via PGSSL_INSECURE=1.
  const sslConfig = sslRequired
    ? { ssl: { rejectUnauthorized: process.env.PGSSL_INSECURE !== "1" } }
    : {};
  _pool = new Pool({
    connectionString: url,
    max: envInt("PGPOOL_MAX", 10),
    idleTimeoutMillis: envInt("PGPOOL_IDLE_MS", 30_000),
    connectionTimeoutMillis: envInt("PGPOOL_CONN_TIMEOUT_MS", 10_000),
    ...sslConfig,
  });
  // A pool-level error handler is required: without it, an idle client error
  // (e.g. server restart) crashes the process with an unhandled 'error' event.
  _pool.on("error", (err) => {
    console.error("[db] idle Postgres client error:", err.message);
  });
  return _pool;
}

export async function initPg(): Promise<void> {
  const client = await getPool().connect();
  let migrationLockHeld = false;
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('aichart-schema-migration'))",
    );
    migrationLockHeld = true;
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `AiChart requires the PostgreSQL pgvector extension before schema initialization: ${message}`,
      );
    }
    await client.query(SCHEMA);
    await migratePg(client);
    await seedAdminPg(client);
    await client.query(
      `INSERT INTO system_flags (key, value)
       VALUES ('schema_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [SCHEMA_VERSION],
    );
  } finally {
    if (migrationLockHeld) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext('aichart-schema-migration'))")
        .catch(() => {});
    }
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
