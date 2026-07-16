import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCALP_GEOMETRY,
  classifyActivation,
  computeGrossR,
  computeNetR,
  levelOrderValid,
  meetsExecutableGeometry,
  roundToTick,
  scoreCandidateQuality,
} from "@/lib/agent/trading/scalpGeometry";
import { buildTradeCandidates } from "@/lib/agent/trading/buildTradeCandidates";
import { analyzePathToEntry } from "@/lib/agent/trading/pathToEntry";
import { validateTradeSetup } from "@/lib/agent/risk/validateTradeSetup";
import { runFinalDecisionSynthesizer } from "@/lib/agent/agents/finalDecisionSynthesizer";
import type { AgentCandle, SupplyDemandZone } from "@/lib/agent/marketContext/detectors";
import type { StructureEvent } from "@/lib/agent/marketContext/structureEvents";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentRunContext } from "@/lib/agent/types";
import { makeRisk, makeStructure } from "./helpers";
import { computeRangePosition } from "@/lib/agent/marketContext/rangePosition";

const BAR = 60_000;

function candle(i: number, o: number, h: number, l: number, c: number): AgentCandle {
  return { time: i * BAR, open: o, high: h, low: l, close: c };
}

describe("scalp geometry contract", () => {
  it("rejects the reported XAUUSD-like 0.75R sell as non-executable", () => {
    const geometry = meetsExecutableGeometry({
      action: "sell",
      entry: 3981.675,
      stop: 3982.7835,
      targets: [3980.84],
      spread: 0.2,
      meta: { tickSize: 0.01, digits: 2 },
    });
    const gross = computeGrossR({
      entry: 3981.675,
      stop: 3982.7835,
      target: 3980.84,
    });
    assert.ok(gross < 1, `gross R ${gross} should be ~0.75`);
    assert.equal(geometry.ok, false);
    assert.equal(geometry.reason, "tp1_net_r_below_minimum");
    assert.ok(geometry.netTp1R < SCALP_GEOMETRY.minNetTp1R);
  });

  it("POI score of 90 cannot override unusable geometry in quality ranking", () => {
    const weak = scoreCandidateQuality({
      poiScore: 90,
      netTp1R: 0.75,
      netTp2R: null,
      activationDistanceAtr: 3,
      structuralTargetCount: 1,
    });
    const strong = scoreCandidateQuality({
      poiScore: 70,
      netTp1R: 2.8,
      netTp2R: 4.5,
      activationDistanceAtr: 0.2,
      structuralTargetCount: 3,
    });
    assert.ok(strong > weak, `quality ${strong} should beat POI-heavy weak ${weak}`);
  });

  it("spread and slippage reduce effective R correctly", () => {
    const gross = computeGrossR({ entry: 100, stop: 98, target: 105 });
    const net = computeNetR({
      action: "buy",
      entry: 100,
      stop: 98,
      target: 105,
      spread: 0.4,
    });
    assert.equal(gross, 2.5);
    assert.ok(net < gross);
    assert.ok(net > 0);
  });

  it("enforces buy/sell level order", () => {
    assert.equal(
      levelOrderValid({ action: "sell", entry: 10, stop: 11, targets: [9] }),
      true,
    );
    assert.equal(
      levelOrderValid({ action: "sell", entry: 10, stop: 9, targets: [8] }),
      false,
    );
    assert.equal(
      levelOrderValid({ action: "buy", entry: 10, stop: 9, targets: [11] }),
      true,
    );
    assert.equal(
      levelOrderValid({ action: "buy", entry: 10, stop: 11, targets: [12] }),
      false,
    );
  });

  it("classifies distant pending entries as conditional", () => {
    const cls = classifyActivation({
      entry: 3981.675,
      currentPrice: 3975.26,
      atr: 1.5,
      entryType: "sell_limit",
    });
    assert.equal(cls, "conditional");
  });

  it("respects symbol tick conventions for XAUUSD, EURUSD, and JPY", () => {
    assert.equal(roundToTick(3981.675, { tickSize: 0.01, digits: 2 }), 3981.68);
    assert.equal(roundToTick(1.08543, { tickSize: 0.00001, digits: 5 }), 1.08543);
    assert.equal(roundToTick(149.123, { tickSize: 0.001, digits: 3 }), 149.123);
  });
});

describe("validateTradeSetup geometry gate", () => {
  it("rejects weak TP1 below minimum net R", () => {
    const result = validateTradeSetup({
      currentPrice: 3975.26,
      dataSufficient: true,
      trade: {
        action: "sell",
        entry: 3981.675,
        stop_loss: 3982.7835,
        targets: [3980.84],
      },
      spread: 0.2,
    });
    assert.equal(result.accepted, false);
    assert.ok((result.netRr ?? 0) < SCALP_GEOMETRY.minNetTp1R);
  });

  it("accepts executable scalp geometry", () => {
    // Prompt example is 2.5R gross; with spread we need a slightly farther
    // structural TP1 so net R still clears the product floor.
    const result = validateTradeSetup({
      currentPrice: 3984,
      dataSufficient: true,
      trade: {
        action: "sell",
        entry: 3984,
        stop_loss: 3986,
        targets: [3978.5, 3974],
      },
      spread: 0.05,
      activationClass: "immediate",
    });
    assert.equal(result.accepted, true);
    assert.ok((result.netRr ?? 0) >= SCALP_GEOMETRY.minNetTp1R);
  });
});

describe("path-to-entry analysis", () => {
  it("does not invent a transitional buy merely because sell entry is above", () => {
    const path = analyzePathToEntry({
      action: "sell",
      currentPrice: 3975.26,
      entry: 3981.675,
      atr: 1.5,
      independentTransitionEvidence: false,
      zoneAlreadyBroken: false,
      driftingAway: false,
    });
    assert.equal(path.class, "neutral_path");
    assert.equal(path.transitionalTradeJustified, false);
  });

  it("requires independent evidence for a transitional trade", () => {
    const path = analyzePathToEntry({
      action: "sell",
      currentPrice: 3975.26,
      entry: 3981.675,
      atr: 1.5,
      independentTransitionEvidence: true,
      zoneAlreadyBroken: false,
      driftingAway: false,
    });
    assert.equal(path.transitionalTradeJustified, true);
    assert.equal(path.class, "continuation_edge");
  });
});

describe("buildTradeCandidates geometry repair", () => {
  function supplyScenario(opts?: {
    nearTarget?: number;
    farTarget?: number;
    currentPrice?: number;
  }) {
    const currentPrice = opts?.currentPrice ?? 3975.26;
    const candles: AgentCandle[] = [];
    // Build a fresh supply zone around 3980–3982 with impulse down then bounce.
    candles.push(candle(0, 3982, 3983, 3980, 3980.5));
    for (let i = 1; i <= 10; i++) {
      const base = 3980 - i * 0.4;
      candles.push(candle(i, base + 0.2, base + 0.5, base - 0.3, base));
    }
    for (let i = 11; i < 50; i++) {
      candles.push(candle(i, 3975, 3976.2, 3974.4, 3975.3));
    }
    const zone: SupplyDemandZone = {
      type: "supply",
      low: 3980.5,
      high: 3982.85,
      time: 0,
    };
    const structureEvents: StructureEvent[] = [
      {
        type: "BOS",
        direction: "bearish",
        brokenLevel: 3978,
        breakCandleTime: 5 * BAR,
        confirmationClose: 3977,
        strength: 70,
        source: "swing",
      },
    ];
    const structural = [
      opts?.nearTarget ?? 3980.84,
      opts?.farTarget ?? 3965,
      3970,
      3960,
    ];
    return buildTradeCandidates({
      candles,
      currentPrice,
      atr: 1.5,
      trend: "downtrend",
      htfBias: "bearish",
      htfConflict: false,
      zones: [zone],
      structureEvents,
      sweeps: [],
      rangePosition: computeRangePosition(candles, currentPrice),
      htfLevels: structural,
      newsRisk: "low",
      spread: 0.2,
      symbolMeta: { tickSize: 0.01, digits: 2 },
    });
  }

  it("does not emit the reported weak XAUUSD candidate as executable", () => {
    const result = supplyScenario({ nearTarget: 3980.84, farTarget: undefined });
    // With only a weak nearby target and no realistic farther structure, no executable candidate.
    if (result.best) {
      assert.ok(result.best.netRr + 1e-9 >= SCALP_GEOMETRY.minNetTp1R);
      assert.ok(result.best.targets[0]! < result.best.entry);
      assert.ok(result.best.entry < result.best.stop_loss);
    } else {
      assert.ok(result.rejectedReasons.length > 0);
    }
  });

  it("uses a farther structural target only when it meets net R", () => {
    const result = supplyScenario({ nearTarget: 3980.84, farTarget: 3968 });
    assert.ok(result.best, "expected executable candidate with far structural target");
    assert.ok(result.best!.netRr + 1e-9 >= SCALP_GEOMETRY.minNetTp1R);
    assert.ok(result.best!.targets[0]! <= 3970);
    assert.equal(result.best!.activationClass, "conditional");
  });

  it("preserves sell order target < entry < stop", () => {
    const result = supplyScenario({ farTarget: 3968 });
    assert.ok(result.best);
    assert.ok(result.best!.targets[0]! < result.best!.entry);
    assert.ok(result.best!.entry < result.best!.stop_loss);
  });
});

describe("AI direction preserved without executable levels", () => {
  const ctx: AgentRunContext = { requestId: "geo", emitActivity: () => {} };

  function market(): AgentMarketContext {
    return {
      symbol: "XAUUSD",
      interval: "1m",
      currentPrice: 3975.26,
      marketRegime: "trend",
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
    } as unknown as AgentMarketContext;
  }

  function candidate(id: string, action: "buy" | "sell"): TradeCandidate {
    const buy = action === "buy";
    return {
      id,
      action,
      entry: buy ? 100 : 3984,
      entryType: "market",
      stop_loss: buy ? 98 : 3986,
      targets: buy ? [105, 110] : [3979, 3974],
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
        low: buy ? 98 : 3983,
        high: buy ? 100 : 3985,
        score: {
          score: 80,
          grade: "A",
          reasons: [],
          warnings: [],
          isTradable: true,
        },
      },
      evidence: ["real"],
      warnings: [],
      invalidationReason: "invalidated",
    };
  }

  it("keeps model SELL when no candidate levels exist", async () => {
    const out = await runFinalDecisionSynthesizer(
      ctx,
      {
        userMessage: "analyze",
        risk: makeRisk(),
        news: null,
        market: market(),
        structure: makeStructure({ trend: "downtrend" }),
        supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
        mtf: null,
        candidates: [],
      },
      {
        configured: true,
        callModel: async () =>
          JSON.stringify({
            decision: "sell",
            selectedTradeCandidateId: null,
            confidence: 0.88,
            summary: "XAUUSD remains bearish but no executable scalp geometry yet.",
            keyReasons: ["structure"],
            riskWarnings: [],
            publicReasoningSummary: ["bearish structure"],
            drawingAdvice: { shouldDraw: false, reason: "none" },
          }),
      },
    );
    assert.equal(out.result?.decision, "sell");
    assert.equal(out.result?.recommendation.action, "sell");
    assert.equal(out.result?.recommendation.entry, undefined);
    assert.match(out.result?.riskWarnings[0] ?? "", /قابلة للتنفيذ/);
  });

  it("binds executable levels only from a real same-side candidate", async () => {
    const sell = candidate("sell-1", "sell");
    const out = await runFinalDecisionSynthesizer(
      ctx,
      {
        userMessage: "analyze",
        risk: makeRisk({
          selectedCandidate: sell,
          candidatesResult: {
            candidates: [sell],
            best: sell,
            rejectedReasons: [],
            hasReversalEvidence: false,
          },
        }),
        news: null,
        market: market(),
        structure: makeStructure({ trend: "downtrend" }),
        supplyDemand: { zones: [], nearestDemand: null, nearestSupply: null },
        mtf: null,
        candidates: [],
      },
      {
        configured: true,
        callModel: async () =>
          JSON.stringify({
            decision: "sell",
            selectedTradeCandidateId: "sell-1",
            confidence: 0.9,
            summary: "Sell XAUUSD from supply with valid scalp geometry.",
            keyReasons: ["supply"],
            riskWarnings: [],
            publicReasoningSummary: ["valid geometry"],
            drawingAdvice: { shouldDraw: true, reason: "zone" },
          }),
      },
    );
    assert.equal(out.result?.recommendation.stop_loss, 3986);
    assert.equal(out.result?.recommendation.activationClass, "immediate");
    assert.ok((out.result?.recommendation.netRr ?? 0) >= 2.5);
  });
});
