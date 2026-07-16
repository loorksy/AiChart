import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runTradingPlaybook,
  type TradingPlaybookInput,
} from "@/lib/agent/trading/tradingPlaybook";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { TradeCandidate } from "@/lib/agent/trading/buildTradeCandidates";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";
import {
  makeCandidatesResult,
  makeLiquidity,
  makeStructure,
} from "./helpers";

function flatCandles(n: number, base = 100): AgentCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: i * 60_000,
    open: base,
    high: base + 0.2,
    low: base - 0.2,
    close: base,
  }));
}

function makeMarket(over: Partial<AgentMarketContext> = {}): AgentMarketContext {
  const current = flatCandles(600);
  return {
    symbol: "EURUSD",
    interval: "15m",
    higherInterval: "1h",
    currentPrice: 101,
    spread: 0.0002,
    atr: 1,
    marketRegime: "uptrend",
    dataQuality: {
      currentTfCount: 600,
      higherTfCount: 250,
      dailyCount: 120,
      sufficient: true,
      policyVersion: "1.1.0",
      coverage: {
        policyVersion: "1.1.0",
        analysisKind: "intraday",
        gate: "trade",
        status: "sufficient",
        sufficientForAnalysis: true,
        sufficientForTrade: true,
        sufficientForDrawing: true,
        timeframes: [],
        summaryAr: "كافٍ",
        summaryEn: "sufficient",
      },
    },
    freshness: { lastCandleTime: 0, ageMs: 0, isFresh: true },
    marketOpen: true,
    currentTfCandles: current,
    higherTfCandles: flatCandles(250),
    dailyCandles: flatCandles(120),
    visibleCandles: current,
    majorLevels: { support: [], resistance: [] },
    liquidity: { equalHighs: [], equalLows: [], nearestBuySide: null, nearestSellSide: null },
    zones: [],
    ...over,
  } as AgentMarketContext;
}

const goodCandidate: TradeCandidate = {
  id: "tc-0",
  action: "buy",
  entry: 100,
  entryType: "market",
  stop_loss: 99,
  targets: [102],
  poi: {
    type: "demand",
    low: 99,
    high: 100,
    score: { score: 88, grade: "A", reasons: [], warnings: [], isTradable: true },
  },
  rr: 2,
  setupType: "trend_continuation",
  evidence: [],
  warnings: [],
  invalidationReason: "close below 99",
};

function baseInput(over: Partial<TradingPlaybookInput> = {}): TradingPlaybookInput {
  return {
    market: makeMarket(),
    structure: makeStructure({ trend: "uptrend" }),
    liquidity: makeLiquidity(),
    mtf: null,
    news: null,
    rangePosition: {
      rangeHigh: 106,
      rangeLow: 99,
      rangeHighTime: 0,
      rangeLowTime: 0,
      equilibrium: 102.5,
      positionPct: 0.28,
      label: "discount",
    },
    candidatesResult: makeCandidatesResult({ best: goodCandidate }),
    candidate: goodCandidate,
    ...over,
  };
}

describe("tradingPlaybook", () => {
  it("describes a clean setup without owning the decision", () => {
    const result = runTradingPlaybook(baseInput());
    assert.equal(result.blockingReasons.length, 0);
    assert.ok(result.checklist.length >= 10);
  });

  it("describes missing candidates without producing a market decision", () => {
    const result = runTradingPlaybook(
      baseInput({ candidate: null, candidatesResult: makeCandidatesResult() }),
    );
    assert.equal(result.blockingReasons.length, 0);
  });

  it("high news risk remains evidence and never blocks", () => {
    const result = runTradingPlaybook(
      baseInput({
        news: {
          newsRisk: "high",
          biasImpact: "unknown",
          affectedCurrencies: [],
          upcomingEvents: [],
          tradeAllowed: false,
          reason: "NFP soon",
        },
      }),
    );
    assert.equal(result.blockingReasons.length, 0);
    assert.equal(result.checklist.find((i) => i.id === "news_risk")?.status, "warning");
  });

  it("insufficient data is a warning for the model", () => {
    const result = runTradingPlaybook(
      baseInput({
        market: makeMarket({
          dataQuality: {
            currentTfCount: 320,
            higherTfCount: 120,
            dailyCount: 60,
            sufficient: true, // analysis gate OK, trade gate NOT
            policyVersion: "1.1.0",
            coverage: {
              policyVersion: "1.1.0",
              analysisKind: "intraday",
              gate: "trade",
              status: "insufficient",
              sufficientForAnalysis: true,
              sufficientForTrade: false,
              sufficientForDrawing: false,
              timeframes: [],
              summaryAr: "غير كافٍ",
              summaryEn: "insufficient",
            },
          },
        }),
      }),
    );
    assert.ok(
      result.checklist.find((i) => i.id === "data_quality")?.status === "warning",
    );
  });

  it("mid-range position is evidence, not a decision gate", () => {
    const result = runTradingPlaybook(
      baseInput({
        rangePosition: {
          rangeHigh: 106,
          rangeLow: 99,
          rangeHighTime: 0,
          rangeLowTime: 0,
          equilibrium: 102.5,
          positionPct: 0.5,
          label: "mid_range",
        },
      }),
    );
    assert.equal(result.blockingReasons.length, 0);
    assert.equal(result.checklist.find((i) => i.id === "range_position")?.status, "warning");
  });

  it("HTF conflict with reversal evidence is a warning, not a block", () => {
    const result = runTradingPlaybook(
      baseInput({
        mtf: { currentBias: "bullish", higherBias: "bearish", dailyBias: "unknown", conflict: true },
        candidatesResult: makeCandidatesResult({
          best: goodCandidate,
          hasReversalEvidence: true,
        }),
      }),
    );
    assert.ok(result.warnings.some((r) => r.includes("انعكاس")));
  });
});
