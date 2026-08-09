import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { FinalDecisionInput } from "@/lib/agent/agents/finalDecisionAgent";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import type { RiskAgentResult } from "@/lib/agent/agents/riskAgent";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import type { HistoricalCaseEvidence } from "@/lib/marketMemory/caseQuery";
import { makeRisk, makeStructure } from "./helpers";

/**
 * The evidence bundle is frozen before the brain reads it
 * (docs/UNIFIED_AGENT_IMPLEMENTATION_PLAN.md §4-ب rules 0-ب, 1 and §20
 * criterion 5).
 *
 * Two rules are checked here, and they fail in opposite directions:
 *
 *   1. The decision call must not MUTATE the bundle. A synthesizer that sorts
 *      candidates in place, or annotates the market context with its own
 *      conclusions, makes every downstream consumer read a bundle that no longer
 *      matches the one the decision was made from — and the evidence snapshot
 *      stored with the revision becomes a description of the aftermath.
 *
 *   2. Evidence must not arrive AFTER the decision. Late evidence (an on-demand
 *      backtest, a deep-research verdict) belongs to a new decision cycle
 *      producing a new revision — never to a quiet edit of the answer already
 *      given.
 */

const ctx: AgentRunContext = { requestId: "immutability-test", emitActivity: () => {} };

function market(): AgentMarketContext {
  return {
    symbol: "EURUSD",
    interval: "5m",
    currentPrice: 1.1,
    marketRegime: "range",
    atr: 0.002,
    spread: 0.00012,
    dataQuality: {
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      sufficient: true,
      policyVersion: "1.1.0",
    },
    currentTfCandles: [],
    higherTfCandles: [],
    dailyCandles: [],
    majorLevels: {
      support: [{ price: 1.09, time: 1 }],
      resistance: [{ price: 1.12, time: 2 }],
    },
    zones: [{ type: "demand", low: 1.095, high: 1.1, time: 3 }],
    liquidity: { equalHighs: [], equalLows: [], nearestBuySide: null, nearestSellSide: null },
  } as unknown as AgentMarketContext;
}

function candidate(id: string, action: "buy" | "sell"): TradeCandidate {
  const buy = action === "buy";
  return {
    id,
    action,
    entry: 1.1,
    entryType: "market",
    stop_loss: buy ? 1.09 : 1.11,
    targets: [buy ? 1.125 : 1.075, buy ? 1.15 : 1.05],
    rr: 2.5,
    netRr: 2.5,
    netRrTp2: 5,
    activationClass: "immediate",
    activationDistance: 0,
    activationDistanceAtr: 0,
    qualityScore: 0.8,
    triggerCondition: "immediate",
    setupType: "trend_continuation",
    poi: {
      type: buy ? "demand" : "supply",
      low: 1.09,
      high: 1.11,
      score: { score: 80, grade: "A", reasons: [], warnings: [], isTradable: true },
    },
    evidence: ["real evidence"],
    warnings: [],
    invalidationReason: "structure invalidated",
  };
}

function risk(...candidates: TradeCandidate[]): RiskAgentResult {
  return makeRisk({
    candidatesResult: {
      candidates,
      best: candidates[0] ?? null,
      rejectedReasons: [],
      hasReversalEvidence: false,
    },
    selectedCandidate: candidates[0] ?? null,
  });
}

function caseEvidence(): HistoricalCaseEvidence {
  return {
    fingerprint: {
      regime: "range",
      trend: "flat",
      rangeZone: "mid",
      pullbackDepth: 0.5,
      impulseAtr: 2.1,
      volatility: 0.0018,
      session: "london",
      structureRun: 2,
    },
    long: {
      sampleSize: 14,
      hitRate: 0.57,
      averageNetR: 0.4,
      averageBars: 11,
      samePattern: null,
      summary: "14 حالة مشابهة",
    },
    short: {
      sampleSize: 9,
      hitRate: 0.44,
      averageNetR: -0.1,
      averageBars: 13,
      samePattern: null,
      summary: "9 حالات مشابهة",
    },
    note: "دليل مساعد",
  };
}

function bundle() {
  return {
    userMessage: "analyze",
    risk: risk(candidate("buy-1", "buy"), candidate("sell-1", "sell")),
    news: null,
    market: market(),
    structure: makeStructure(),
    supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
    mtf: null,
    candidates: [],
    statisticalSupport: {
      level: "moderate" as const,
      detail: "3 deployments, 240 trades",
    },
    historicalCases: caseEvidence(),
  } as unknown as FinalDecisionInput & { candidates: [] };
}

/** Structural fingerprint, order included — a reordered array is a changed bundle. */
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const answer = JSON.stringify({
  direction: "buy",
  planType: "immediate",
  selectedTradeCandidateId: "buy-1",
  proposedLevels: null,
  activationCondition: null,
  invalidationRule: "إغلاق شمعة تحت 1.09 يبطل الفكرة.",
  alternativeScenario: "كسر 1.09 يقلب المشهد إلى بيع.",
  validityCandles: 6,
  confidence: 0.62,
  summary: "قرار EURUSD مبني على الأدلة المرفقة.",
  keyReasons: ["الطلب صمد"],
  riskWarnings: [],
  publicReasoningSummary: ["الطلب صمد مرتين"],
  decisionTrace: {
    hypotheses: [{ scenario: "ارتداد", supporting: ["هيكل"], opposing: ["سبريد"] }],
    chosenBecause: "الطلب صمد مرتين.",
    planTypeBecause: "السعر داخل المنطقة.",
  },
  drawingAdvice: { shouldDraw: false, reason: "none" },
});

describe("the evidence bundle is frozen before the brain reads it", () => {
  it("returns a recursively frozen snapshot of exactly what the model read", async () => {
    let sentToModel = "";
    const out = await runFinalDecisionSynthesizer(ctx, bundle(), {
      configured: true,
      callModel: async (_system, user) => {
        sentToModel = user;
        return answer;
      },
    });
    assert.ok(out.evidenceSnapshot);
    assert.ok(Object.isFrozen(out.evidenceSnapshot));
    assert.ok(Object.isFrozen(out.evidenceSnapshot!.modelContext));
    assert.deepEqual(
      out.evidenceSnapshot!.modelContext,
      JSON.parse(sentToModel),
      "the persisted snapshot must be the same object serialized for the brain",
    );
  });

  it("comes back byte-identical after a decision", async () => {
    const input = bundle();
    const before = fingerprint(input);

    const out = await runFinalDecisionSynthesizer(ctx, input, {
      configured: true,
      callModel: async () => answer,
    });
    assert.equal(out.result?.decision, "buy");
    assert.equal(
      fingerprint(input),
      before,
      "the decision call mutated the evidence bundle — the snapshot stored with " +
        "the revision would describe the aftermath, not the inputs",
    );
  });

  it("comes back unchanged even when the decision fails", async () => {
    const input = bundle();
    const before = fingerprint(input);
    const out = await runFinalDecisionSynthesizer(ctx, input, {
      configured: true,
      callModel: async () => "not json at all",
    });
    assert.equal(out.result, null);
    assert.equal(fingerprint(input), before, "a failed decision mutated the bundle");
  });

  it("does not reorder the candidate list it was given", async () => {
    const input = bundle();
    const candidates = input.risk!.candidatesResult.candidates;
    const idsBefore = candidates.map((entry) => entry.id);

    await runFinalDecisionSynthesizer(ctx, input, {
      configured: true,
      callModel: async () => answer,
    });
    assert.deepEqual(
      input.risk!.candidatesResult.candidates.map((entry) => entry.id),
      idsBefore,
      "candidates were reordered in place; the ranking the model saw is now unrecoverable",
    );
  });

  it("reaches the same decision from the same bundle", async () => {
    // Determinism given a fixed model answer: everything between the bundle and
    // the result is pure. If this drifts, some hidden state is leaking in.
    const first = await runFinalDecisionSynthesizer(ctx, bundle(), {
      configured: true,
      callModel: async () => answer,
    });
    const second = await runFinalDecisionSynthesizer(ctx, bundle(), {
      configured: true,
      callModel: async () => answer,
    });
    assert.deepEqual(second.result, first.result);
  });

  it("carries the case memory for both directions, not just the chosen one", async () => {
    // The bundle is built before a direction exists. If only one side were
    // fetched, the memory would be confirming a choice instead of informing it.
    const input = bundle();
    let sentToModel = "";
    await runFinalDecisionSynthesizer(ctx, input, {
      configured: true,
      callModel: async (_system, user) => {
        sentToModel = user;
        return answer;
      },
    });
    const context = JSON.parse(sentToModel.slice(sentToModel.indexOf("{")));
    assert.ok(context.historicalCases, "the case memory never reached the model");
    assert.ok(context.historicalCases.long, "the long side is missing");
    assert.ok(context.historicalCases.short, "the short side is missing");
  });

  it("reports an absent memory as absent rather than omitting it", async () => {
    const input = bundle();
    (input as unknown as { historicalCases: unknown }).historicalCases = null;
    let sentToModel = "";
    await runFinalDecisionSynthesizer(ctx, input, {
      configured: true,
      callModel: async (_system, user) => {
        sentToModel = user;
        return answer;
      },
    });
    const context = JSON.parse(sentToModel.slice(sentToModel.indexOf("{")));
    // Present and null, not missing: the model must be able to tell "no
    // comparable history" from "this evidence was never looked at".
    assert.ok("historicalCases" in context);
    assert.equal(context.historicalCases, null);
  });
});
