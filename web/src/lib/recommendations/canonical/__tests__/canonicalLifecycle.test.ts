import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { RecommendationOutcomeType } from "@/lib/recommendations/canonical";

const dir = mkdtempSync(join(tmpdir(), "aichart-phase4-"));
process.env.DB_PATH = join(dir, "phase4.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "phase4-test-secret";
delete process.env.DATABASE_URL;

let owner = 0;
let attacker = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["phase4-owner@example.com", "x", "user", "active"],
  );
  attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["phase4-attacker@example.com", "x", "user", "active"],
  );
});

describe("canonical recommendation lifecycle", () => {
  it("enforces strict transitions, tenant ownership, outcomes, learning events and replay", async () => {
    const lifecycle = await import("@/lib/recommendations/canonical");
    const recommendation = await lifecycle.createCanonicalRecommendation({
      userId: owner,
      analysisId: "analysis-1",
      sessionId: "session-1",
      chatId: "chat-1",
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      direction: "buy",
      entry: 2300,
      stopLoss: 2290,
      targets: [2310, 2320, 2330],
      risk: { riskPercent: 1 },
      confidence: 88,
      strategyId: "gold-breakout",
      strategyVersion: "2",
      expiresAt: Date.now() + 3_600_000,
      source: "test",
      engineVersion: "phase4-test",
      entryType: "buy_stop",
    });
    assert.equal(recommendation.status, "active");
    assert.equal(
      await lifecycle.getCanonicalRecommendation(attacker, recommendation.recommendationId),
      null,
    );

    const triggered = await lifecycle.transitionRecommendation({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      toStatus: "triggered",
      trigger: "entry_touch",
      actor: "tracker",
      source: "test",
      reason: "entry reached",
    });
    assert.equal(triggered.status, "triggered");
    await assert.rejects(
      lifecycle.transitionRecommendation({
        userId: owner,
        recommendationId: recommendation.recommendationId,
        toStatus: "active",
        trigger: "bad",
        actor: "test",
        source: "test",
        reason: "illegal rollback",
      }),
      (error: unknown) =>
        error instanceof lifecycle.RecommendationLifecycleError &&
        error.code === "RECOMMENDATION_ILLEGAL_TRANSITION",
    );

    const db = await import("@/lib/db");
    await db.execute(`
      CREATE TRIGGER phase4_test_transition_failure
      BEFORE INSERT ON recommendation_transitions
      WHEN NEW.reason = 'forced transition failure'
      BEGIN SELECT RAISE(ABORT, 'forced transition failure'); END
    `);
    await assert.rejects(
      lifecycle.transitionRecommendation({
        userId: owner,
        recommendationId: recommendation.recommendationId,
        toStatus: "partially_closed",
        trigger: "test",
        actor: "test",
        source: "test",
        reason: "forced transition failure",
      }),
      /forced transition failure/,
    );
    await db.execute("DROP TRIGGER phase4_test_transition_failure");
    assert.equal(
      (await lifecycle.getCanonicalRecommendation(owner, recommendation.recommendationId))?.status,
      "triggered",
      "state projection rolls back when immutable history append fails",
    );

    const tp1 = await lifecycle.recordRecommendationOutcome({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      type: "TP1",
      targetIndex: 1,
      rMultiple: 1,
      pnl: 100,
      holdingMs: 60_000,
      mae: 0.25,
      mfe: 1.1,
      spreadCost: 2,
      slippage: 1,
      commission: 3,
      riskUsed: 100,
      source: "test",
      evidence: { candleId: "c1" },
      dedupeKey: "tp1",
    });
    const duplicate = await lifecycle.recordRecommendationOutcome({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      type: "TP1",
      targetIndex: 1,
      source: "test",
      dedupeKey: "tp1",
    });
    assert.equal(duplicate.id, tp1.id, "outcome append is idempotent by evidence key");
    await lifecycle.transitionRecommendation({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      toStatus: "partially_closed",
      trigger: "tp1",
      actor: "tracker",
      source: "test",
      reason: "first target reached",
    });
    await lifecycle.recordRecommendationOutcome({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      type: "TP3",
      targetIndex: 3,
      rMultiple: 3,
      pnl: 300,
      holdingMs: 120_000,
      mae: 0.25,
      mfe: 3,
      source: "test",
      evidence: { candleId: "c2" },
      dedupeKey: "tp3",
    });
    await lifecycle.transitionRecommendation({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      toStatus: "tp_hit",
      trigger: "tp3",
      actor: "tracker",
      source: "test",
      reason: "final target reached",
    });

    const events = await lifecycle.listRecommendationLearningEvents(
      owner,
      recommendation.recommendationId,
    );
    assert.deepEqual(
      new Set(events.map((event) => event.eventType)),
      new Set(["PartialTargetHit", "FinalTargetHit", "RecommendationSucceeded"]),
    );
    const replay = await lifecycle.replayRecommendation(owner, recommendation.recommendationId);
    assert.equal(replay.reconstructed.status, "tp_hit");
    assert.ok(replay.timeline.some((event) => event.kind === "history"));
    assert.ok(replay.timeline.some((event) => event.kind === "transition"));
    assert.ok(replay.timeline.some((event) => event.kind === "outcome"));
    assert.ok(replay.timeline.some((event) => event.kind === "learning"));
    await assert.rejects(
      db.execute(
        "UPDATE recommendation_transitions SET reason = ? WHERE recommendation_id = ?",
        ["overwrite", recommendation.recommendationId],
      ),
      /append-only/,
    );
    await assert.rejects(
      db.execute(
        "UPDATE recommendation_outcomes SET pnl = ? WHERE recommendation_id = ?",
        [999999, recommendation.recommendationId],
      ),
      /append-only/,
    );
  });

  it("records every supported outcome and emits the corresponding append-only event", async () => {
    const lifecycle = await import("@/lib/recommendations/canonical");
    const recommendation = await lifecycle.createCanonicalRecommendation({
      userId: owner,
      symbol: "EURUSD",
      market: "forex",
      timeframe: "15m",
      direction: "buy",
      entry: 1.1,
      stopLoss: 1.09,
      targets: [1.11, 1.12, 1.13],
      confidence: 80,
      strategyId: "coverage",
      source: "test",
    });
    const types: RecommendationOutcomeType[] = [
      "BreakEven",
      "Trailing",
      "ManualClose",
      "Expired",
      "Cancelled",
      "Invalidated",
      "SL",
      "TP2",
    ];
    for (const type of types) {
      await lifecycle.recordRecommendationOutcome({
        userId: owner,
        recommendationId: recommendation.recommendationId,
        type,
        source: "test",
        dedupeKey: type,
      });
    }
    const outcomes = await lifecycle.listRecommendationOutcomes(owner, recommendation.recommendationId);
    assert.deepEqual(new Set(outcomes.map((outcome) => outcome.type)), new Set(types));
    const events = await lifecycle.listRecommendationLearningEvents(owner, recommendation.recommendationId);
    assert.deepEqual(
      new Set(events.map((event) => event.eventType)),
      new Set([
        "BreakEvenReached",
        "TrailingActivated",
        "RecommendationExpired",
        "RecommendationCancelled",
        "RecommendationInvalidated",
        "RecommendationFailed",
        "PartialTargetHit",
      ]),
    );
  });
});

describe("canonical adapters, lessons, Gold versions and analytics", () => {
  it("writes tracked recommendations only through the canonical table", async () => {
    const db = await import("@/lib/db");
    const adapter = await import("@/lib/recommendations/recommendationStore");
    const created = await adapter.createTrackedRecommendation({
      id: "legacy-adapter-id",
      userId: owner,
      chatId: "adapter-session",
      symbol: "GBPUSD",
      interval: "1h",
      direction: "sell",
      entryType: "pending",
      entry: 1.25,
      stopLoss: 1.26,
      targets: [1.24],
      status: "pending_entry",
      outcome: "pending",
      createdAt: Date.now(),
      createdCandleTime: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    });
    assert.equal(created.id, "legacy-adapter-id");
    const canonicalCount = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM recommendations WHERE user_id = ? AND legacy_tracking_id = ?",
      [owner, "legacy-adapter-id"],
    );
    const legacyCount = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM tracked_recommendations WHERE user_id = ?",
      [owner],
    );
    assert.equal(Number(canonicalCount?.count), 1);
    assert.equal(Number(legacyCount?.count), 0);

    const now = Date.now();
    await db.execute(
      `INSERT INTO tracked_recommendations
        (id, user_id, symbol, interval, direction, entry_type, entry, stop_loss,
         targets, status, outcome, created_at, created_candle_time, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        "pre-phase4-row",
        owner,
        "USDJPY",
        "1h",
        "buy",
        "pending",
        150,
        149,
        "[151]",
        "pending_entry",
        "pending",
        now,
        now,
        now + 3_600_000,
      ],
    );
    const imported = await adapter.migrateLegacyTrackedRecommendations(owner);
    assert.equal(imported, 1);
    const migrated = await adapter.getTrackedRecommendation(owner, "pre-phase4-row");
    assert.equal(migrated?.symbol, "USDJPY");
    const stillLegacy = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM tracked_recommendations WHERE id = ?",
      ["pre-phase4-row"],
    );
    assert.equal(Number(stillLegacy?.count), 1, "legacy source is preserved non-destructively");
  });

  it("deduplicates evidence-backed lesson candidates and versions Gold weights without live mutation", async () => {
    const lifecycle = await import("@/lib/recommendations/canonical");
    for (let index = 0; index < 20; index += 1) {
      const recommendation = await lifecycle.createCanonicalRecommendation({
        userId: owner,
        symbol: index % 2 ? "XAUUSD" : "XAUEUR",
        market: "forex",
        timeframe: "1h",
        direction: "buy",
        entry: 2300,
        stopLoss: 2290,
        targets: [2310, 2320, 2330],
        confidence: 90,
        strategyId: "gold-agent-x",
        strategyVersion: "1",
        source: "test",
      });
      await lifecycle.recordRecommendationOutcome({
        userId: owner,
        recommendationId: recommendation.recommendationId,
        type: "TP3",
        targetIndex: 3,
        rMultiple: 3,
        source: "validated-review",
        evidence: {
          validated: true,
          direction: "buy",
          advisorVotes: [{ advisor: "trend", vote: "buy" }],
        },
        dedupeKey: `validated-${index}`,
      });
    }
    const db = await import("@/lib/db");
    const candidateRows = await db.query<{ id: number }>(
      "SELECT id FROM trade_lesson_candidates WHERE user_id = ? AND strategy_id = ?",
      [owner, "gold-agent-x"],
    );
    assert.equal(candidateRows.length, 1, "duplicate lesson fingerprints collapse to one candidate");
    const validatedLesson = await lifecycle.validateTradeLessonCandidate(owner, candidateRows[0]!.id);
    assert.equal(validatedLesson?.status, "validated");
    assert.equal(validatedLesson?.sampleSize, 20);
    assert.ok((validatedLesson?.evidenceEventIds.length ?? 0) >= 20);

    const originalWeights = { trend: 1 };
    const version1 = await lifecycle.proposeGoldWeightVersion({
      userId: owner,
      strategyId: "gold-agent-x",
      currentWeights: originalWeights,
    });
    assert.equal(version1?.status, "candidate");
    assert.deepEqual(originalWeights, { trend: 1 }, "proposal never mutates live input weights");
    const active1 = await lifecycle.activateGoldWeightVersion(owner, "gold-agent-x", version1!.version);
    assert.equal(active1?.status, "active");
    const version2 = await lifecycle.proposeGoldWeightVersion({
      userId: owner,
      strategyId: "gold-agent-x",
      currentWeights: active1!.weights,
    });
    await lifecycle.activateGoldWeightVersion(owner, "gold-agent-x", version2!.version);
    const rolledBack = await lifecycle.rollbackGoldWeightVersion(owner, "gold-agent-x", version1!.version);
    assert.equal(rolledBack?.version, version1?.version);
    assert.equal(rolledBack?.status, "active");
    const history = await lifecycle.listGoldWeightVersions(owner, "gold-agent-x");
    assert.equal(history.length, 2);

    const analytics = await lifecycle.computeCanonicalRecommendationAnalytics(owner);
    assert.ok(analytics.bySymbol.some((group) => group.key === "XAUUSD"));
    assert.ok(analytics.byTimeframe.some((group) => group.key === "1h"));
    assert.ok(analytics.byStrategy.some((group) => group.key === "gold-agent-x"));
    assert.ok(analytics.byConfidence.length > 0);
    assert.ok(analytics.bySession.length > 0);
    assert.ok(analytics.byExitReason.length > 0);
    assert.ok(analytics.byEntryType.length > 0);
    assert.ok(analytics.byMonth.length > 0);
    assert.ok(analytics.byDay.length > 0);
  });
});
