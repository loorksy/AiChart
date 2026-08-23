import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { BacktestEvidenceReference } from "@/lib/tradingDna";
import { gatedCompletePlan } from "@/lib/recommendations/__tests__/fixtures/completePlan";

const directory = mkdtempSync(join(tmpdir(), "aichart-phase5-"));
process.env.DB_PATH = join(directory, "phase5.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "phase5-test-secret";
delete process.env.DATABASE_URL;

let owner = 0;
let attacker = 0;
const recommendationIds: number[] = [];

const backtests = (userId: number): BacktestEvidenceReference[] => [
  {
    jobId: "rj_phase5_backtest",
    userId,
    verifiedAt: Date.now(),
    artifactIds: ["ra_metrics_phase5", "ra_trades_phase5"],
    jobType: "run_forex_backtest",
    status: "succeeded",
    resultSummary: "completed",
  },
  {
    jobId: "rj_phase5_validation",
    userId,
    verifiedAt: Date.now(),
    artifactIds: ["ra_validation_phase5"],
    jobType: "run_backtest_validation",
    status: "succeeded",
    resultSummary: "validated",
  },
];

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  owner = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["phase5-owner@example.com", "x", "user", "active"],
  );
  attacker = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["phase5-attacker@example.com", "x", "user", "active"],
  );
  // The owner needs a subscription, not a trial: this fixture writes ten
  // historical plans to have a track record to derive a persona from, and the
  // three-recommendation trial cap is claimed at the same creation choke point.
  // The cap is correct — the fixture was the thing pretending to be a trial.
  await db.execute(
    `INSERT INTO user_entitlements (user_id, plan_status)
     VALUES (?, 'active')
     ON CONFLICT (user_id) DO UPDATE SET plan_status = 'active'`,
    [owner],
  );
  const lifecycle = await import("@/lib/recommendations/canonical");
  for (let index = 0; index < 10; index += 1) {
    const won = index < 7;
    const symbol = index < 8 ? "XAUUSD" : "EURUSD";
    const recommendation = await lifecycle.createCanonicalRecommendation({
      ...(await gatedCompletePlan(owner, {
        analysisId: `phase5-analysis-${index}`,
        symbol,
      })),
      userId: owner,
      sessionId: `phase5-session-${index}`,
      symbol,
      market: "forex",
      timeframe: index % 3 === 0 ? "15m" : "1h",
      direction: won ? "buy" : "sell",
      entry: 2300 + index,
      // Coherent levels per side — the write boundary now rejects a sell
      // whose stop sits below its entry, which this fixture used to do.
      stopLoss: won ? 2290 + index : 2310 + index,
      targets: won
        ? [2310 + index, 2320 + index, 2330 + index]
        : [2290 + index, 2280 + index, 2270 + index],
      risk: { source: "recorded" },
      confidence: won ? 78 : 82,
      strategyId: "trend-breakout",
      strategyVersion: "1",
      createdAt: Date.UTC(2026, 0, index + 1, index < 5 ? 9 : 14),
      source: "phase5-test",
    });
    recommendationIds.push(recommendation.recommendationId);
    await lifecycle.recordRecommendationOutcome({
      userId: owner,
      recommendationId: recommendation.recommendationId,
      type: won ? "TP3" : "SL",
      targetIndex: won ? 3 : undefined,
      rMultiple: won ? 2 + index / 10 : -1,
      pnl: won ? 200 + index * 10 : -100,
      holdingMs: (index + 1) * 3_600_000,
      mae: 0.2 + index / 100,
      mfe: won ? 2 + index / 10 : 0.4,
      spreadCost: 1 + index / 10,
      slippage: 0.2 + index / 100,
      commission: 2,
      riskUsed: 50 + index * 5,
      occurredAt: Date.UTC(2026, 0, index + 1, 18),
      source: "phase5-test",
      evidence: { validated: true, source: "canonical-outcome" },
      dedupeKey: `phase5-result-${index}`,
    });
    if (index < 2) {
      await lifecycle.recordRecommendationOutcome({
        userId: owner,
        recommendationId: recommendation.recommendationId,
        type: index === 0 ? "BreakEven" : "Trailing",
        occurredAt: Date.UTC(2026, 0, index + 1, 17),
        source: "phase5-test",
        dedupeKey: `phase5-management-${index}`,
      });
    }
  }
  const candidates = await db.query<{ id: number }>(
    "SELECT id FROM trade_lesson_candidates WHERE user_id = ? ORDER BY id ASC",
    [owner],
  );
  assert.ok(candidates.length > 0);
  await lifecycle.validateTradeLessonCandidate(owner, candidates[0]!.id);
});

describe("Trading DNA evidence and metrics", () => {
  it("builds tenant-scoped supported metrics and preserves unsupported fields explicitly", async () => {
    const dna = await import("@/lib/tradingDna");
    const generated = await dna.generateTradingDnaSnapshot(owner, {
      backtests: backtests(owner),
      now: Date.UTC(2026, 1, 1),
    });
    assert.equal(generated.snapshot.userId, owner);
    assert.equal(generated.snapshot.version, 1);
    // Canonical evidence records a single strategy ("direct_analysis"), so the
    // persona derives from recorded holding times: 1-10h averages within a day.
    assert.equal(generated.persona.persona, "intraday");
    assert.ok(generated.persona.confidence > 0);
    for (const key of [
      "risk_tolerance",
      "average_r",
      "average_holding_time",
      "mae",
      "mfe",
      "win_loss_behavior",
      "risk_scaling",
      "drawdown_recovery",
      "confidence_calibration",
      "execution_consistency",
      "backtest_coverage",
    ]) {
      assert.equal(
        generated.snapshot.metrics.find((metric) => metric.key === key)?.status,
        "supported",
        `${key} should be backed by the seeded evidence`,
      );
    }
    assert.ok(generated.snapshot.conclusions.length > 0);
    assert.ok(generated.snapshot.conclusions.every((item) => item.evidence.recommendationIds.length > 0));
    assert.equal(await dna.getTradingDnaSnapshot(attacker, generated.snapshot.snapshotId), null);

    const emptyDraft = await dna.buildTradingDnaDraft(attacker);
    assert.ok(emptyDraft.metrics.every((metric) => metric.status === "insufficient_evidence"));
    assert.deepEqual(emptyDraft.conclusions, []);
    await assert.rejects(
      dna.collectTradingDnaEvidence(owner, { backtests: backtests(attacker) }),
      /Unverified Research Service backtest evidence/,
    );
  });

  it("rejects unsupported conclusions and keeps derived records immutable", async () => {
    const dna = await import("@/lib/tradingDna");
    const db = await import("@/lib/db");
    await assert.rejects(
      dna.persistTradingDnaSnapshot({
        userId: owner,
        sampleSize: 0,
        metrics: [],
        conclusions: [
          {
            id: "unsupported",
            type: "pattern",
            text: "unsupported",
            confidence: 1,
            evidence: dna.emptyEvidence(),
          },
        ],
        evidence: dna.emptyEvidence(),
      }),
      /no historical evidence/,
    );
    const latest = await dna.getLatestTradingDnaSnapshot(owner);
    assert.ok(latest);
    await assert.rejects(
      dna.persistShadowRecommendation({
        userId: attacker,
        snapshotId: latest!.snapshotId,
        symbol: "XAUUSD",
        timeframe: "1h",
        direction: "wait",
        confidence: 0,
        rationale: ["cross-tenant attempt"],
        evidence: { ...dna.emptyEvidence(), recommendationIds: [recommendationIds[0]!] },
        createdAt: Date.now(),
      }),
      /does not belong to this tenant/,
    );
    await assert.rejects(
      db.execute("UPDATE trading_dna_snapshots SET sample_size = 999 WHERE snapshot_id = ?", [latest!.snapshotId]),
      /append-only/,
    );
    await assert.rejects(
      db.execute("UPDATE trading_persona_versions SET confidence = 1 WHERE snapshot_id = ?", [latest!.snapshotId]),
      /append-only/,
    );
  });
});

describe("Shadow Trader, replay, reports and analytics", () => {
  it("creates research-only shadow observations and replays canonical evidence", async () => {
    const dna = await import("@/lib/tradingDna");
    const shadow = await dna.generateShadowRecommendation({
      userId: owner,
      symbol: "XAUUSD",
      timeframe: "15m",
      backtests: backtests(owner),
      now: Date.UTC(2026, 1, 2),
    });
    assert.equal(shadow.researchOnly, true);
    assert.equal(shadow.executionProhibited, true);
    assert.ok(["buy", "sell", "wait"].includes(shadow.direction));
    assert.ok(shadow.evidence.recommendationIds.length > 0);
    // No trade ids, and this is the assertion rather than a dropped one: the
    // execution layer that produced them is gone, so a shadow recommendation
    // linking to a trade would mean something wrote one.
    assert.deepEqual(shadow.evidence.tradeIds, []);
    assert.ok(shadow.evidence.learningEventIds.length > 0);
    assert.ok(shadow.evidence.backtestIds.length > 0);
    assert.equal("entry" in shadow, false);
    assert.equal("qty" in shadow, false);
    assert.equal(await dna.getShadowRecommendation(attacker, shadow.shadowRecommendationId), null);

    const replay = await dna.replayShadowRecommendation(owner, shadow.shadowRecommendationId);
    assert.ok(replay.timeline.some((event) => event.kind === "dna_snapshot"));
    assert.ok(replay.timeline.some((event) => event.kind === "canonical_outcome"));
    assert.ok(replay.timeline.some((event) => event.kind === "canonical_learning"));
    assert.equal(replay.timeline.at(-1)?.kind, "shadow_created");

    const analytics = await dna.computeTradingDnaAnalytics(owner);
    assert.equal(analytics.behaviourOverTime.length, 2);
    assert.equal(analytics.strategyEvolution.length, 2);
    assert.equal(analytics.drawdownEvolution.length, 2);
  });

  it("renders bounded JSON, escaped HTML and a valid PDF envelope", async () => {
    const dna = await import("@/lib/tradingDna");
    const snapshot = await dna.getLatestTradingDnaSnapshot(owner);
    assert.ok(snapshot);
    const persona = await dna.getPersonaForSnapshot(owner, snapshot!.snapshotId);
    assert.ok(persona);
    const report = dna.buildTradingDnaReport(snapshot!, persona!);
    const json = dna.renderTradingDnaJson(report);
    assert.equal(JSON.parse(json).schemaVersion, "aichart-trading-dna-report-v1");
    const injected = {
      ...report,
      strengths: [
        {
          ...report.snapshot.conclusions[0]!,
          type: "strength" as const,
          text: "<script>alert('x')</script>",
        },
      ],
    };
    const html = dna.renderTradingDnaHtml(injected);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.equal(html.includes("<script>alert"), false);
    const pdf = dna.renderTradingDnaPdf(report);
    assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
    assert.ok(pdf.length > 500);
  });
});
