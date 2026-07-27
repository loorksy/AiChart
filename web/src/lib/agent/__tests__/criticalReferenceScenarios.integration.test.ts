/**
 * Critical §16 scenarios that need executable integration assertions beyond
 * the synthesizer contract pack. Controlled model adapters consume the real
 * evidence path; they never write recommendations or revisions themselves.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { scenarioById } from "./fixtures/referenceScenarioPack";

const dir = mkdtempSync(join(tmpdir(), "aichart-critical-ref-"));
process.env.DB_PATH = join(dir, "critical.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "critical-ref-secret";
process.env.AUTO_EXECUTION_STAGE = "off";
process.env.REC_LIFECYCLE_ALERTS_V1 = "1";
process.env.VISION_DECISION_V1 = "0";
process.env.FEATURE_AGENT_SKILLS = "0";
process.env.CASE_MEMORY_V1 = "0";
process.env.AGENT_RUN_TRACE_V1 = "0";
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.OANDA_API_TOKEN;

let db: typeof import("@/lib/db");
let userId = 0;

before(async () => {
  db = await import("@/lib/db");
  await db.initDb();
  userId = await db.insertReturningId(
    "INSERT INTO users (email, password_hash, role, status) VALUES (?,?,?,?)",
    ["critical-ref@example.com", "x", "user", "active"],
  );
  await db.execute("INSERT INTO trading_settings (user_id) VALUES (?)", [userId]);
});

describe("critical reference scenario integrations", () => {
  it("corrupt_market_data returns an operational block without a recommendation", async () => {
    const scenario = scenarioById("corrupt_market_data");
    assert.equal(scenario.expected.operationalBlock, true);
    const orchestrator = await import("@/lib/agent/orchestrator");
    // Seed genuinely MALFORMED candles (high < low), not an empty dataset — the
    // scenario exists to prove bad feed data never becomes an invented price,
    // which an empty table cannot demonstrate.
    const { fixtureBars } = await import("./fixtures/referenceScenarioPack");
    const candleRepository = await import("@/lib/candles/candleRepository");
    const corruptBars = fixtureBars({
      count: 650,
      intervalMs: 15 * 60_000,
      endAt: Date.UTC(2026, 4, 15, 12, 0, 0),
      start: 1.08,
      shape: scenario.fixture.shape,
    });
    assert.ok(
      corruptBars.every((bar) => bar.high < bar.low),
      "the corrupt fixture must actually be malformed, not silently sanitized",
    );
    await candleRepository.upsertCandles("EURUSD", "15m", corruptBars);
    const beforeCount = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ?",
      [userId],
    );
    const result = await orchestrator.runUnifiedChartAgent({
      surface: "platform",
      purpose: "analysis",
      userMessage: "Analyze EURUSD with no usable candles.",
      chartContext: {
        symbol: "EURUSD",
        interval: "15m",
        dataSource: "oanda",
      },
      requestContext: {
        requestId: "critical-corrupt",
        userId,
        emitActivity: () => {},
      },
      account: null,
      canExecute: false,
      synthesizerDeps: {
        configured: true,
        callModel: async () => {
          throw new Error("model must not be called without market evidence");
        },
      },
    });
    assert.ok(
      result.envelope?.outcome_class === "operational_blocker" ||
        result.recommendation == null ||
        result.decision == null,
      "corrupt/thin data must not invent a tradeable recommendation",
    );
    const afterCount = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ?",
      [userId],
    );
    assert.equal(Number(afterCount[0]?.n), Number(beforeCount[0]?.n));
  });

  it("calendar_provider_absent invents no events and still stores a plan", async () => {
    const { saveRecommendation } = await import("@/lib/store");
    const { runFinalDecisionSynthesizer } = await import(
      "@/lib/agent/agents/finalDecisionSynthesizer"
    );
    const { makeRisk, makeStructure } = await import("./helpers");
    const out = await runFinalDecisionSynthesizer(
      { requestId: "cal-absent", emitActivity: () => {} },
      {
        userMessage: "analyze",
        risk: makeRisk(),
        news: null,
        market: {
          symbol: "EURUSD",
          interval: "15m",
          currentPrice: 1.085,
          atr: 0.001,
          spread: 0.0001,
          marketRegime: "trend",
          dataQuality: {
            currentTfCount: 600,
            higherTfCount: 250,
            dailyCount: 120,
            sufficient: true,
            policyVersion: "1.2.0",
          },
          currentTfCandles: [],
          higherTfCandles: [],
          dailyCandles: [],
          majorLevels: {
            support: [{ price: 1.08, time: 1 }],
            resistance: [{ price: 1.09, time: 2 }],
          },
          zones: [],
          liquidity: {
            equalHighs: [],
            equalLows: [],
            nearestBuySide: null,
            nearestSellSide: null,
          },
        } as never,
        structure: makeStructure(),
        supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
        mtf: null,
        candidates: [],
      },
      {
        configured: true,
        callModel: async () =>
          JSON.stringify({
            direction: "buy",
            planType: "immediate",
            selectedTradeCandidateId: null,
            proposedLevels: {
              preferredEntry: 1.084,
              stopLoss: 1.08,
              targets: [1.09],
            },
            activationCondition: null,
            invalidationRule: "Close below 1.08.",
            alternativeScenario: "Break below support flips the plan.",
            validityCandles: 6,
            confidence: 0.66,
            summary: "Calendar absent — plan still stands.",
            keyReasons: ["structure"],
            riskWarnings: [],
            publicReasoningSummary: ["direct analysis"],
            decisionTrace: {
              hypotheses: [
                {
                  scenario: "continuation",
                  supporting: ["structure"],
                  opposing: ["calendar unknown"],
                },
              ],
              chosenBecause: "structure",
              planTypeBecause: "entry is available",
            },
            drawingAdvice: { shouldDraw: false, reason: "n/a" },
            selectedCandidateIds: [],
            requestExtraTimeframe: null,
          }),
      },
    );
    assert.ok(out.result);
    const news = out.result!.evidenceDimensions?.find((d) => d.key === "news_impact");
    assert.equal(news?.grade, "unavailable");
    const saved = await saveRecommendation(userId, {
      symbol: "EURUSD",
      action: "buy",
      confidence: 66,
      entry: 1.084,
      stop_loss: 1.08,
      take_profit: 1.09,
      plan_type: "immediate",
      source: "agent",
    });
    assert.ok(saved.id);
  });

  it("cost_ruins_entry keeps a conditional plan and never distorts levels", async () => {
    const { runFinalDecisionSynthesizer } = await import(
      "@/lib/agent/agents/finalDecisionSynthesizer"
    );
    const { makeRisk, makeStructure } = await import("./helpers");
    const weak = {
      id: "tc-cost",
      action: "buy" as const,
      entry: 3996,
      entryType: "buy_limit" as const,
      stop_loss: 3990,
      targets: [4010],
      rr: 2.4,
      netRr: 0.8,
      netRrTp2: 2,
      activationClass: "conditional" as const,
      activationDistance: 4,
      activationDistanceAtr: 2,
      qualityScore: 0.5,
      triggerCondition: "better price",
      setupType: "range_boundary",
      poi: {
        type: "demand",
        low: 3992,
        high: 3996,
        score: { score: 60, grade: "C", reasons: [], warnings: ["cost"], isTradable: true },
      },
      evidence: ["zone"],
      warnings: ["العائد الصافي للهدف الأول ضعيف"],
      invalidationReason: "close below 3990",
    };
    const out = await runFinalDecisionSynthesizer(
      { requestId: "cost-ruins", emitActivity: () => {} },
      {
        userMessage: "analyze",
        risk: makeRisk({
          selectedCandidate: null,
          candidatesResult: {
            candidates: [weak as never],
            best: weak as never,
            rejectedReasons: [],
            hasReversalEvidence: false,
          },
        }),
        news: null,
        market: {
          symbol: "XAUUSD",
          interval: "5m",
          currentPrice: 4000,
          atr: 2,
          spread: 0.2,
          marketRegime: "range",
          dataQuality: {
            currentTfCount: 600,
            higherTfCount: 250,
            dailyCount: 120,
            sufficient: true,
            policyVersion: "1.2.0",
          },
          currentTfCandles: [],
          higherTfCandles: [],
          dailyCandles: [],
          majorLevels: {
            support: [{ price: 3990, time: 1 }],
            resistance: [{ price: 4010, time: 2 }],
          },
          zones: [{ type: "demand", low: 3992, high: 3996, time: 3 }],
          liquidity: {
            equalHighs: [],
            equalLows: [],
            nearestBuySide: null,
            nearestSellSide: null,
          },
        } as never,
        structure: makeStructure(),
        supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
        mtf: null,
        candidates: [],
      },
      {
        configured: true,
        callModel: async () =>
          JSON.stringify({
            direction: "buy",
            planType: "conditional",
            selectedTradeCandidateId: null,
            proposedLevels: {
              entryLow: 3992,
              entryHigh: 3996,
              preferredEntry: 3992,
              stopLoss: 3990,
              targets: [4010],
            },
            activationCondition: "عودة السعر إلى 3992 حيث يغطي الهدف التكاليف.",
            invalidationRule: "إغلاق تحت 3990 يبطل الفكرة.",
            alternativeScenario: "كسر 3990 يقلب المشهد.",
            validityCandles: 6,
            confidence: 0.7,
            summary: "Cost ruins the current entry.",
            keyReasons: ["cost"],
            riskWarnings: ["cost"],
            publicReasoningSummary: ["conditional for cost"],
            decisionTrace: {
              hypotheses: [
                {
                  scenario: "buy cheaper",
                  supporting: ["zone"],
                  opposing: ["spread"],
                },
              ],
              chosenBecause: "zone still valid",
              planTypeBecause: "current fill is uneconomic",
            },
            drawingAdvice: { shouldDraw: false, reason: "n/a" },
            selectedCandidateIds: [],
            requestExtraTimeframe: null,
          }),
      },
    );
    assert.ok(out.result);
    assert.equal(out.result!.planType, "conditional");
    assert.equal(out.result!.recommendation.levelSource, "evidence_levels");
    assert.equal(out.result!.recommendation.entry, 3992);
    assert.equal(out.result!.recommendation.stop_loss, 3990);
  });

  it("condition_during_revision: lock prefers revision apply; old intent is stale", async () => {
    const repository = await import("@/lib/recommendations/canonical/repository");
    const revisions = await import("@/lib/recommendations/canonical/revisions");
    const { createIntent } = await import("@/lib/store");
    const execution = await import("@/lib/execution");
    const created = await repository.createCanonicalRecommendation({
      userId,
      symbol: "EURUSD",
      market: "forex",
      timeframe: "15m",
      direction: "buy",
      entry: 1.1,
      stopLoss: 1.09,
      targets: [1.12],
      risk: {},
      confidence: 70,
      strategyId: "unspecified",
      strategyVersion: "1",
      source: "agent",
      engineVersion: "critical-ref",
      planType: "conditional",
      executionState: "awaiting_activation",
      expiresAt: Date.now() + 3_600_000,
    });
    const intent = await createIntent(userId, {
      recommendation_id: created.recommendationId,
      recommendation_revision_no: 1,
      authorization_source: "user_approved",
      symbol: "EURUSD",
      side: "buy",
      notional: 100,
      market: "forex",
      broker: "mt_ea",
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      status: "approved",
      rationale: "stale-race",
    });
    await revisions.applyRecommendationRevision({
      userId,
      recommendationId: created.recommendationId,
      revision: {
        direction: "buy",
        planType: "conditional",
        executionState: "awaiting_activation",
        entry: 1.101,
        stopLoss: 1.091,
        targets: [1.121],
        reason: "market_update while condition resolved",
        source: "market_update",
      },
    });
    // The stage gate sits upstream of the CAS and fails closed; open it so the
    // refusal under test is the stale-revision one, then restore the file's
    // default. The server-recorded approval is what a real operator leaves.
    const dbForApproval = await import("@/lib/db");
    await dbForApproval.execute(
      "UPDATE trade_intents SET approved_at = ?, approved_by_user_id = ? WHERE id = ?",
      [Date.now(), userId, intent.id],
    );
    process.env.AUTO_EXECUTION_STAGE = "live";
    try {
      const result = await execution.executeIntent(userId, intent.id, {
        explicitApproval: true,
      });
      assert.equal(result.ok, false);
      assert.match(String(result.reason ?? result.errorCode), /stale|النسخة|2/i);
    } finally {
      process.env.AUTO_EXECUTION_STAGE = "off";
    }
  });

  it("auto_conditional does not place while stage is off or condition unmet", async () => {
    process.env.AUTO_EXECUTION_STAGE = "off";
    const { maybeAutoExecute, autoExecutionStage } = await import(
      "@/lib/recommendations/autoExecutor"
    );
    assert.equal(autoExecutionStage(), "off");
    const outcome = await maybeAutoExecute({
      recommendation: {
        id: "auto-cond-1",
        userId,
        symbol: "EURUSD",
        direction: "buy",
        entry: 1.1,
        stopLoss: 1.09,
        targets: [1.12],
        revisionNo: 1,
        status: "pending_entry",
      } as never,
      events: [
        {
          type: "activated",
          recommendationId: "auto-cond-1",
          symbol: "EURUSD",
          revisionNo: 1,
          dedupeKey: "auto-cond-1:1:activated",
          detail: "activated",
          terminal: false,
          occurredAt: Date.now(),
        },
      ],
    });
    assert.equal(outcome.placed, false);
    assert.equal(outcome.code, "stage_off");

    // try/finally: an assertion failure below must not leak a non-off stage
    // into the tests that run after this one in the same process.
    try {
      process.env.AUTO_EXECUTION_STAGE = "dry_run";
      const waiting = await maybeAutoExecute({
        recommendation: {
          id: "auto-cond-2",
          userId,
          symbol: "EURUSD",
          direction: "buy",
          entry: 1.1,
          stopLoss: 1.09,
          targets: [1.12],
          revisionNo: 1,
          status: "pending_entry",
        } as never,
        events: [],
      });
      assert.equal(waiting.placed, false);
      assert.equal(waiting.code, "not_activated");
    } finally {
      process.env.AUTO_EXECUTION_STAGE = "off";
    }
  });

  it("account_disconnected refuses auto and still analyzes", async () => {
    const { setTradeMode, getTradeMode, isAutoExecutionAuthorized } = await import(
      "@/lib/agent/tradeMode"
    );
    await assert.rejects(
      setTradeMode({ userId, mode: "auto", actor: "platform" }),
      /حساب متصل|connected/i,
    );
    const view = await getTradeMode(userId);
    assert.notEqual(view.mode, "auto");
    assert.equal(await isAutoExecutionAuthorized(userId), false);
  });

  it("disconnect_during_auto drops to advisory and blocks standing_auto", async () => {
    const { suspendAutoOnDisconnect, getTradeMode, isAutoExecutionAuthorized } =
      await import("@/lib/agent/tradeMode");
    await db.execute(
      `UPDATE trading_settings
          SET agent_trade_mode = 'auto', agent_trade_mode_epoch = ?, agent_trade_mode_updated_at = ?
        WHERE user_id = ?`,
      ["9:99999", Date.now(), userId],
    );
    assert.equal(await suspendAutoOnDisconnect(userId), true);
    const view = await getTradeMode(userId);
    assert.equal(view.mode, "advisory");
    assert.equal(await isAutoExecutionAuthorized(userId), false);

    const { createIntent } = await import("@/lib/store");
    const execution = await import("@/lib/execution");
    const intent = await createIntent(userId, {
      recommendation_id: null,
      authorization_source: "standing_auto",
      symbol: "EURUSD",
      side: "buy",
      notional: 100,
      market: "forex",
      broker: "mt_ea",
      entry: 1.1,
      stop_loss: 1.09,
      take_profit: 1.12,
      status: "approved",
      rationale: "after disconnect",
    });
    // Open the upstream stage gate so the refusal proven here is the AUTH one:
    // the standing grant died with the disconnect, and no stage may resurrect
    // it. Restored to the file's default afterwards.
    process.env.AUTO_EXECUTION_STAGE = "live";
    try {
      const result = await execution.executeIntent(userId, intent.id, {
        explicitApproval: true,
      });
      assert.equal(result.ok, false);
      assert.ok(
        ["auto_mode_revoked", "unauthorized_source", "not_authorized"].includes(
          result.errorCode ?? "",
        ),
        `unexpected errorCode: ${result.errorCode}`,
      );
    } finally {
      process.env.AUTO_EXECUTION_STAGE = "off";
    }
  });

  it("expired_or_invalidated emits execution_skipped once for a terminal plan", async () => {
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const event = {
      type: "execution_skipped" as const,
      recommendationId: "term-1",
      symbol: "EURUSD",
      revisionNo: 1,
      dedupeKey: "term-1:1:execution_skipped:expired",
      detail: "EURUSD: امتنع التنفيذ التلقائي — الخطة منتهية",
      terminal: false,
      occurredAt: Date.now(),
    };
    const first = await notifyLifecycleEvents(userId, [event]);
    assert.equal(first.delivered, 1);
    const second = await notifyLifecycleEvents(userId, [event]);
    assert.equal(second.delivered, 0);
    assert.equal(second.suppressedDuplicate, 1);
  });

  it("retest_started notifies once through lifecycle dedupe", async () => {
    const { deriveLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleEvents"
    );
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const events = deriveLifecycleEvents({
      recommendation: {
        id: "retest-1",
        userId,
        symbol: "EURUSD",
        direction: "buy",
        entry: 1.1,
        stopLoss: 1.09,
        targets: [1.12],
        status: "pending_entry",
      } as never,
      previousStatus: "pending_entry",
      nextStatus: "pending_entry",
      currentPrice: 1.1002,
      atr: 0.002,
      retestLevel: 1.1,
      revisionNo: 1,
    });
    const retest = events.filter((e) => e.type === "retest_started");
    assert.equal(retest.length, 1);
    const first = await notifyLifecycleEvents(userId, retest);
    assert.equal(first.delivered, 1);
    const second = await notifyLifecycleEvents(userId, retest);
    assert.equal(second.suppressedDuplicate, 1);
  });

  it("breakout_no_retest notifies once through lifecycle dedupe", async () => {
    const { deriveLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleEvents"
    );
    const { notifyLifecycleEvents } = await import(
      "@/lib/recommendations/lifecycleNotifier"
    );
    const events = deriveLifecycleEvents({
      recommendation: {
        id: "break-1",
        userId,
        symbol: "EURUSD",
        direction: "buy",
        entry: 1.1,
        stopLoss: 1.09,
        targets: [1.12],
        status: "pending_entry",
      } as never,
      previousStatus: "pending_entry",
      nextStatus: "pending_entry",
      currentPrice: 1.118,
      atr: 0.002,
      retestLevel: 1.1,
      excursionAtr: 2,
      revisionNo: 1,
    });
    const breakout = events.filter((e) => e.type === "breakout_no_retest");
    assert.equal(breakout.length, 1);
    const first = await notifyLifecycleEvents(userId, breakout);
    assert.equal(first.delivered, 1);
    const second = await notifyLifecycleEvents(userId, breakout);
    assert.equal(second.suppressedDuplicate, 1);
  });
});
