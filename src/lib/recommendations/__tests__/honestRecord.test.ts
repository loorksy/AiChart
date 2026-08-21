/**
 * Phase 7 — forward outcome tracking and the honest record.
 *
 * Much of this phase existed before it was named: the evaluator expires an
 * untriggered plan (recommendationStatus.test.ts), the stats layer refuses
 * to call that a loss and floors its win rate (recommendationStats.test.ts).
 * What is pinned HERE is the record itself against real stored rows, plus
 * the sample-size floor in the two surfaces that lacked it: the canonical
 * analytics and the Trading-DNA win/loss metric.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

// Env FIRST — static app imports would hoist above these lines and bind the
// db module to the default dev path, so every repo module loads dynamically.
const dir = mkdtempSync(join(tmpdir(), "aichart-record-"));
process.env.DB_PATH = join(dir, "record.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "record-test-secret";
delete process.env.DATABASE_URL;

let userId = 0;

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["record@example.com", "x", "user", "active"],
  );
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')
     ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
    [userId],
  );

  const { gatedTrackedPlan } = await import(
    "@/lib/recommendations/__tests__/fixtures/completePlan"
  );
  const store = await import("@/lib/recommendations/recommendationStore");
  const now = Date.now();
  const base = (index: number) => ({
    userId,
    symbol: "XAUUSD",
    interval: "15m" as const,
    direction: "buy" as const,
    entryType: "market" as const,
    entry: 4000 + index,
    stopLoss: 3990 + index,
    targets: [4010 + index, 4020 + index],
    createdAt: now - (index + 1) * 3_600_000,
    createdCandleTime: now - (index + 1) * 3_600_000,
    expiresAt: now + 3_600_000,
  });

  // Two wins and a loss — all genuinely triggered.
  for (const [index, fate] of (
    [
      ["record-w1", "tp1_hit", "win_tp1"],
      ["record-w2", "tp2_hit", "win_tp2"],
      ["record-l1", "sl_hit", "loss"],
    ] as const
  ).entries()) {
    await store.createTrackedRecommendation({
      ...base(index),
      ...(await gatedTrackedPlan(userId, { analysisId: `record-a${index}`, symbol: "XAUUSD" })),
      id: fate[0],
      status: fate[1],
      outcome: fate[2],
      triggeredAt: now - (index + 1) * 1_800_000,
    });
  }
  // A conditional that never activated and ran out of validity: expired.
  await store.createTrackedRecommendation({
    ...base(3),
    ...(await gatedTrackedPlan(userId, {
      analysisId: "record-a3",
      symbol: "XAUUSD",
      planType: "conditional",
    })),
    id: "record-exp",
    status: "expired",
    outcome: "expired",
  });
  // And one still open.
  await store.createTrackedRecommendation({
    ...base(4),
    ...(await gatedTrackedPlan(userId, { analysisId: "record-a4", symbol: "XAUUSD" })),
    id: "record-open",
    status: "pending_entry",
    outcome: "pending",
  });
});

describe("the honest record", () => {
  it("lists every recommendation with its outcome — nothing filtered", async () => {
    const store = await import("@/lib/recommendations/recommendationStore");
    const { toPublicTrackedRecommendation } = await import(
      "@/lib/recommendations/publicEvidenceProjection"
    );
    const recs = await store.listTrackedRecommendations(userId, { limit: 100 });
    assert.equal(recs.length, 5);
    const outcomes = recs.map((rec) => rec.outcome).sort();
    // Losses and expiries sit in the same list as wins — the record hides
    // nothing, and that is the point of keeping one.
    assert.deepEqual(outcomes, ["expired", "loss", "pending", "win_tp1", "win_tp2"]);

    // The browser projection keeps the full plan contract AND the outcome.
    for (const rec of recs) {
      const projected = toPublicTrackedRecommendation(rec);
      assert.equal(projected.outcome, rec.outcome);
      assert.ok(projected.invalidationRule, `${rec.id} keeps its invalidation rule`);
      assert.ok(projected.alternativeScenario, `${rec.id} keeps its alternative scenario`);
      assert.ok(projected.validityCandles, `${rec.id} keeps its validity window`);
    }
    const conditional = recs.find((rec) => rec.id === "record-exp");
    assert.equal(conditional?.planType, "conditional");
    assert.ok(conditional?.activationRule, "the conditional keeps its activation rule");
  });

  it("treats the unactivated expiry as expired — never a loss — and floors the rate", async () => {
    const store = await import("@/lib/recommendations/recommendationStore");
    const { computeRecommendationStats } = await import(
      "@/lib/recommendations/recommendationStats"
    );
    const recs = await store.listTrackedRecommendations(userId, { limit: 100 });
    const stats = computeRecommendationStats(recs);
    assert.equal(stats.losses, 1, "only the triggered SL is a loss");
    assert.equal(stats.wins, 2);
    assert.equal(stats.breakdown.expired, 1);
    assert.equal(stats.breakdown.untriggeredExpired, 1);
    // 3 completed < the floor of 8 → no percentage exists to show.
    assert.equal(stats.winRate, null);
  });

  it("canonical analytics refuse a win-rate percentage below the sample floor", async () => {
    // A separate tenant, so the tracked fixtures above cannot blur the counts.
    const db = await import("@/lib/db");
    const analyticsUser = await db.insertReturningId(
      "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
      ["record-analytics@example.com", "x", "user", "active"],
    );
    await db.execute(
      `INSERT INTO user_entitlements (user_id, plan_status) VALUES (?, 'active')
       ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
      [analyticsUser],
    );
    const { gatedCompletePlan } = await import(
      "@/lib/recommendations/__tests__/fixtures/completePlan"
    );
    const lifecycle = await import("@/lib/recommendations/canonical");
    for (let index = 0; index < 3; index += 1) {
      const won = index < 2;
      const created = await lifecycle.createCanonicalRecommendation({
        ...(await gatedCompletePlan(analyticsUser, { analysisId: `record-canon-${index}` })),
        userId: analyticsUser,
        symbol: "XAUUSD",
        market: "forex",
        timeframe: "1h",
        direction: won ? "buy" : "sell",
        entry: 4100 + index,
        stopLoss: won ? 4090 + index : 4110 + index,
        targets: won ? [4110 + index, 4120 + index] : [4090 + index, 4080 + index],
        risk: { source: "recorded" },
        confidence: 70,
        source: "record-test",
      });
      await lifecycle.recordRecommendationOutcome({
        userId: analyticsUser,
        recommendationId: created.recommendationId,
        type: won ? "TP3" : "SL",
        rMultiple: won ? 2 : -1,
        occurredAt: Date.now(),
        source: "record-test",
        dedupeKey: `record-canon-out-${index}`,
      });
    }
    const { computeCanonicalRecommendationAnalytics } = await import(
      "@/lib/recommendations/canonical/analytics"
    );
    const analytics = await computeCanonicalRecommendationAnalytics(analyticsUser);
    assert.equal(analytics.wins, 2);
    assert.equal(analytics.losses, 1);
    // Counts always; a percentage only past the floor.
    assert.equal(analytics.winRate, null);
    assert.equal(analytics.lossRate, null);
    for (const group of analytics.bySymbol) {
      assert.equal(group.winRate, null, `group ${group.key} stays counts-only`);
    }
  });

  it("the DNA win/loss metric stays insufficient below the floor", async () => {
    const { computeTradingDnaMetrics } = await import("@/lib/tradingDna/metrics");
    const now = Date.now();
    const recommendations = Array.from({ length: 5 }, (_, index) => ({
      recommendationId: index + 1,
      symbol: "XAUUSD",
      market: "forex",
      timeframe: "1h",
      strategyId: "direct_analysis",
      direction: "buy" as const,
      confidence: 70,
      status: index < 3 ? "tp_hit" : "sl_hit",
      createdAt: now - index * 3_600_000,
    }));
    const metrics = computeTradingDnaMetrics({
      userId,
      collectedAt: now,
      recommendations,
      outcomes: [],
      learningEvents: recommendations.map((rec, index) => ({
        eventId: `ev-${index}`,
        recommendationId: rec.recommendationId,
        eventType: index < 3 ? "RecommendationSucceeded" : "RecommendationFailed",
        occurredAt: now,
      })),
      trades: [],
      lessons: [],
      backtests: [],
    });
    const winLoss = metrics.find((metric) => metric.key === "win_loss_behavior");
    assert.ok(winLoss);
    assert.equal(
      winLoss!.status,
      "insufficient_evidence",
      "5 completed recommendations are below the 8-sample floor",
    );
  });

  it("the scenario memory block below the floor carries counts, never a percentage", async () => {
    const { buildScenarioBlock } = await import("@/lib/agent/memory/scenarioMemory");
    const small = buildScenarioBlock({
      key: "XAUUSD",
      total: 5,
      wins: 3,
      losses: 2,
      winRate: null,
      averageR: 0.4,
    });
    assert.doesNotMatch(small, /%/);
    assert.match(small, /5/);
    assert.match(small, /3/);
    const large = buildScenarioBlock({
      key: "XAUUSD",
      total: 12,
      wins: 7,
      losses: 5,
      winRate: (7 / 12) * 100,
      averageR: 0.4,
    });
    assert.match(large, /58%/);
  });
});
