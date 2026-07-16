import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  execute,
  initDb,
  insertReturningId,
  query,
  queryOne,
} from "../src/lib/db";
import {
  computeCanonicalRecommendationAnalytics,
  createCanonicalRecommendation,
  getCanonicalRecommendation,
  recordRecommendationOutcome,
  replayRecommendation,
  transitionRecommendation,
} from "../src/lib/recommendations/canonical";
import { ensureUserDefaults } from "../src/lib/store";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");

const databaseName = new URL(databaseUrl).pathname.slice(1);
assert.match(
  databaseName,
  /^aichart_rel[a-z0-9_]*$/,
  "Refusing to run PostgreSQL release validation outside an aichart_rel* database",
);

const expectedSettingsColumns = [
  "user_id",
  "per_trade_pct",
  "allowed_assets",
  "forex_backend",
  "send_screenshot",
  "telegram_chat_id",
  "onboarding_done",
  "alerts_enabled",
  "alert_trades",
  "alert_signals",
  "updated_at",
];

const expectedAdminColumns = [
  "user_id",
  "can_execute",
  "claude_quota",
  "updated_at",
];

const requiredTables = [
  "admin_limits",
  "agent_audit_logs",
  "agent_chat_messages",
  "agent_chats",
  "agent_run_steps",
  "agent_runs",
  "agent_tool_calls",
  "audit_logs",
  "chart_layouts",
  "chat_messages",
  "conversations",
  "deep_analysis_runs",
  "market_candles",
  "recommendation_history",
  "recommendation_learning_events",
  "recommendation_outcomes",
  "recommendation_transitions",
  "recommendations",
  "semantic_memories",
  "shadow_recommendations",
  "system_flags",
  "tracked_recommendations",
  "trade_intents",
  "trade_lesson_candidates",
  "trade_lessons",
  "trades",
  "trading_dna_snapshots",
  "trading_persona_versions",
  "trading_settings",
  "users",
];

const removedColumns = [
  "active_market",
  "alert_min_confidence",
  "analysis_interval",
  "approval",
  "auto_take_profit_usd",
  "committee_json",
  "daily_loss_limit_pct",
  "daily_profit_target_pct",
  "daily_profit_target_usd",
  "default_leverage",
  "execution_env_preference",
  "experience",
  "futures_enabled",
  "kill_switch",
  "last_manual_scan_at",
  "max_capital",
  "max_capital_cap",
  "max_leverage_cap",
  "max_open_trades",
  "max_open_trades_cap",
  "min_confidence",
  "min_rr",
  "mode",
  "monthly_loss_limit_pct",
  "risk_guard_enabled",
  "risk_veto",
  "scalp_enabled",
  "scalp_execution_mode",
  "scalp_max_trades",
  "scan_poll_minutes",
  "style",
  "trading_style",
];

async function columnNames(table: string): Promise<string[]> {
  const rows = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ?
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

async function run(): Promise<void> {
  await initDb();

  assert.deepEqual(await columnNames("trading_settings"), expectedSettingsColumns);
  assert.deepEqual(await columnNames("admin_limits"), expectedAdminColumns);

  const tables = new Set(
    (
      await query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      )
    ).map((row) => row.table_name),
  );
  for (const table of requiredTables) {
    assert.ok(tables.has(table), `required table is missing: ${table}`);
  }

  const obsolete = await query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = ANY(?)`,
    [removedColumns],
  );
  assert.deepEqual(obsolete, [], "obsolete policy columns remain");

  const defaultRow = await queryOne<{ column_default: string }>(
    `SELECT column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'trading_settings'
        AND column_name = 'per_trade_pct'`,
  );
  assert.equal(defaultRow?.column_default, "1");

  const riskConstraint = await queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM pg_constraint
      WHERE conname = 'trading_settings_per_trade_pct_valid'`,
  );
  assert.equal(Number(riskConstraint?.count), 1);

  const schemaVersion = await queryOne<{ value: string }>(
    "SELECT value FROM system_flags WHERE key = 'schema_version'",
  );
  assert.equal(
    schemaVersion?.value,
    "2026-07-16-aichart-simplification-v1",
  );

  const suffix = crypto.randomUUID();
  const owner = await insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`pg-owner-${suffix}@example.invalid`, "x", "user", "active"],
  );
  const attacker = await insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    [`pg-attacker-${suffix}@example.invalid`, "x", "user", "active"],
  );

  try {
    await ensureUserDefaults(owner);
    await ensureUserDefaults(attacker);
    const rawDefault = await queryOne<{ per_trade_pct: number }>(
      "SELECT per_trade_pct FROM trading_settings WHERE user_id = ?",
      [owner],
    );
    assert.equal(Number(rawDefault?.per_trade_pct), 1);

    await assert.rejects(
      execute(
        "UPDATE trading_settings SET per_trade_pct = ? WHERE user_id = ?",
        [1.25, owner],
      ),
      /trading_settings_per_trade_pct_valid/,
    );

    const recommendation = await createCanonicalRecommendation({
      userId: owner,
      analysisId: `pg-analysis-${suffix}`,
      sessionId: `pg-session-${suffix}`,
      chatId: `pg-chat-${suffix}`,
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "5m",
      direction: "buy",
      entry: 2300,
      stopLoss: 2298,
      targets: [2302, 2304, 2306],
      risk: { riskPercent: 1 },
      confidence: 82,
      strategyId: "canonical-scalp",
      strategyVersion: "1",
      source: "postgres-release-validation",
      engineVersion: "canonical-agent",
      entryType: "market",
    });

    assert.equal(
      await getCanonicalRecommendation(
        attacker,
        recommendation.recommendationId,
      ),
      null,
      "tenant isolation failed",
    );

    await transitionRecommendation({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      toStatus: "triggered",
      trigger: "validation",
      actor: "release-test",
      source: "postgres-release-validation",
      reason: "isolated validation",
    });

    const firstOutcome = await recordRecommendationOutcome({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      type: "TP1",
      targetIndex: 1,
      rMultiple: 1,
      pnl: 1,
      source: "postgres-release-validation",
      dedupeKey: "release-validation-tp1",
      evidence: { isolated: true },
    });
    const duplicateOutcome = await recordRecommendationOutcome({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      type: "TP1",
      targetIndex: 1,
      source: "postgres-release-validation",
      dedupeKey: "release-validation-tp1",
    });
    assert.equal(duplicateOutcome.id, firstOutcome.id);

    await transitionRecommendation({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      toStatus: "partially_closed",
      trigger: "validation_tp1",
      actor: "release-test",
      source: "postgres-release-validation",
      reason: "isolated validation target",
    });

    const replay = await replayRecommendation(
      owner,
      recommendation.recommendationId,
    );
    assert.equal(replay.reconstructed.status, "partially_closed");
    assert.ok(replay.timeline.some((event) => event.kind === "history"));
    assert.ok(replay.timeline.some((event) => event.kind === "transition"));
    assert.ok(replay.timeline.some((event) => event.kind === "outcome"));
    assert.ok(replay.timeline.some((event) => event.kind === "learning"));

    const analytics = await computeCanonicalRecommendationAnalytics(owner);
    assert.ok(analytics.total >= 1);
    assert.ok(analytics.bySymbol.some((group) => group.key === "XAUUSD"));

    await assert.rejects(
      execute(
        "UPDATE recommendation_transitions SET reason = ? WHERE recommendation_id = ?",
        ["mutated", recommendation.recommendationId],
      ),
      /append-only/,
    );
  } finally {
    await execute("DELETE FROM users WHERE id IN (?, ?)", [owner, attacker]);
  }

  console.log(
    JSON.stringify({
      database: databaseName,
      schema: "ok",
      riskConstraint: "ok",
      tenantIsolation: "ok",
      recommendationReplay: "ok",
      outcomeIdempotency: "ok",
      appendOnlyEvidence: "ok",
    }),
  );
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
