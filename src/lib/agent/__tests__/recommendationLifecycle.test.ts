import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRecommendationStatus } from "@/lib/agent/recommendation/evaluateRecommendationStatus";
import {
  computeRecommendationExpiry,
  getActiveRecommendation,
  isActiveRecommendationLive,
  rememberActiveRecommendation,
  updateActiveRecommendationStatus,
  type ActiveRecommendation,
} from "@/lib/agent/sessionRecommendation";
import type { AgentMarketContext } from "@/lib/agent/marketContext/buildAgentMarketContext";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";

const T = Date.UTC(2026, 0, 1, 12, 0, 0);

function candle(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
): AgentCandle {
  return {
    time: T + i * 60_000,
    open,
    high,
    low,
    close,
  };
}

function rec(over: Partial<ActiveRecommendation> = {}): ActiveRecommendation {
  return {
    id: `rec-${Math.random()}`,
    analysisId: "a1",
    sessionId: "s1",
    symbol: "EURUSD",
    interval: "1m",
    createdAt: T,
    direction: "buy",
    entry: 100,
    stopLoss: 99,
    targets: [200],
    status: "pending_entry",
    triggerCondition: "touch 100",
    invalidationLevel: 99,
    invalidationRule: "close below 99 invalidates",
    summary: "buy setup",
    keyReasons: ["demand zone"],
    riskWarnings: [],
    publicReasoningSummary: ["demand zone"],
    ...over,
  };
}

function market(candles: AgentCandle[]): AgentMarketContext {
  return {
    currentPrice: candles.at(-1)?.close ?? null,
    currentTfCandles: candles,
    interval: "1m",
    higherInterval: "5m",
    higherTfCandles: [],
    atr: null,
  } as unknown as AgentMarketContext;
}

describe("sessionRecommendation", () => {
  it("remembers and retrieves the active recommendation by session and symbol", async () => {
    const active = rec({
      id: "rec-store-1",
      sessionId: "session-store-1",
      symbol: "EURUSD",
    });
    await rememberActiveRecommendation(active);
    const stored = await getActiveRecommendation("session-store-1", "EURUSD");
    assert.equal(stored?.id, active.id);
    assert.equal(isActiveRecommendationLive(stored), true);
  });

  it("terminal statuses are no longer treated as live", async () => {
    const active = rec({
      id: "rec-store-2",
      sessionId: "session-store-2",
      symbol: "EURUSD",
    });
    await rememberActiveRecommendation(active);
    await updateActiveRecommendationStatus(active.id, "sl_hit", "hit stop");
    const stored = await getActiveRecommendation("session-store-2", "EURUSD");
    assert.equal(stored?.status, "sl_hit");
    assert.equal(isActiveRecommendationLive(stored), false);
  });
});

describe("evaluateRecommendationStatus", () => {
  // NOTE: the graded candles start at i=1. The candle whose open time equals
  // the creation moment is the candle that was FORMING at creation, and the
  // canonical evaluator (one source of truth with the sweep) never grades it.
  it("keeps a recommendation pending before entry touch", () => {
    // Gold fill band is 10–15 points. Sitting 0.5 above the entry used to
    // mean "not a touch"; it is now inside the band. Keep this fixture on
    // the waiting side (buy still BELOW) and outside the band, without
    // running through TP1 — a candle above the target expires as a miss.
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(1, 81, 81.2, 80.5, 81)]),
    });
    assert.equal(status.status, "pending_entry");
    assert.equal(status.triggered, false);
  });

  it("marks a recommendation triggered after entry touch, citing the honest fill", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(1, 101, 101.2, 99.8, 100.5)]),
    });
    assert.equal(status.status, "triggered");
    assert.equal(status.triggered, true);
    assert.equal(status.effectiveEntry, 100);
  });

  it("marks target hits after entry trigger", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec({ targets: [102] }),
      market: market([candle(1, 101, 102.1, 99.8, 101.5)]),
    });
    assert.equal(status.status, "tp1_hit");
    assert.equal(status.hitTarget, 1);
  });

  it("a wick through the stop with a close back inside does NOT stop a pending-limit plan", () => {
    // Close-confirmed invalidation (the XAUUSD conditional-sell fix): a
    // pending/limit plan's invalidation is worded on the candle CLOSE, so the
    // intrabar spike through the 99 stop with a close back at 100.4 is a
    // rejection the plan survives — the old touch grading called this a loss.
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(1, 101, 101.2, 98.9, 100.4)]),
    });
    assert.equal(status.status, "triggered");
    assert.equal(status.invalidationMode, "close");
  });

  it("marks the stop hit when a candle CLOSES beyond it", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(1, 101, 101.2, 98.7, 98.9)]),
    });
    assert.equal(status.status, "sl_hit");
    assert.equal(status.triggered, true);
  });

  it("does not let the creation candle trigger or stop the recommendation", () => {
    // The candle at T created the recommendation; even though it dips to the
    // entry and stop, it must be ignored — only later candles count.
    const status = evaluateRecommendationStatus({
      recommendation: rec({ createdCandleTime: T }),
      market: market([candle(0, 101, 101.2, 98.9, 99.2)]),
    });
    assert.equal(status.status, "pending_entry");
    assert.equal(status.triggered, false);
  });

  it("evaluates candles strictly after the creation candle", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec({ createdCandleTime: T }),
      market: market([
        candle(0, 101, 101.2, 98.9, 99.2), // creation candle — ignored
        candle(1, 101, 101.2, 99.8, 100.5), // next candle triggers entry
      ]),
    });
    assert.equal(status.triggered, true);
    assert.equal(status.status, "triggered");
  });

  it("does not re-evaluate a terminal recommendation as active", () => {
    // Price action here would hit TP1, but a cancelled recommendation stays put.
    const status = evaluateRecommendationStatus({
      recommendation: rec({ status: "cancelled" }),
      market: market([candle(0, 101, 102.1, 99.8, 101.5)]),
    });
    assert.equal(status.status, "cancelled");
  });

  it("keeps an SL result from being overwritten by later target hits", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec({ status: "sl_hit" }),
      market: market([candle(0, 101, 102.1, 99.8, 101.5)]),
    });
    assert.equal(status.status, "sl_hit");
  });

  it("expires a recommendation past its expiry deadline", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec({ expiresAt: Date.now() - 1000 }),
      market: market([candle(0, 101, 101.2, 100.5, 101)]),
    });
    assert.equal(status.status, "expired");
  });

  it("gold screenshot: sell TP1 4591.48, live low 4596.15 is a zone hit via evaluateRecommendation", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec({
        symbol: "XAUUSD",
        direction: "sell",
        entry: 4607.59,
        stopLoss: 4616.36,
        targets: [4591.48, 4575, 4560],
        status: "triggered",
        entryType: "market",
        invalidationMode: "touch",
        triggeredAt: T,
      }),
      market: market([candle(1, 4600, 4602, 4596.15, 4596.15)]),
    });
    assert.equal(status.status, "tp1_hit");
    assert.equal(status.hitTarget, 1);
    assert.match(status.reason, /4596\.15/);
    assert.match(status.reason, /اعتُبر الهدف ملموساً/);
  });
});

describe("computeRecommendationExpiry", () => {
  it("gives scalps a short lifetime and higher timeframes a long one", () => {
    const from = T;
    const scalp = computeRecommendationExpiry({ interval: "1m", scalp: true, from });
    const oneMin = computeRecommendationExpiry({ interval: "1m", from });
    const fourH = computeRecommendationExpiry({ interval: "4h", from });
    assert.ok(scalp - from <= 30 * 60_000);
    assert.ok(oneMin - from > scalp - from);
    assert.ok(fourH - from > oneMin - from);
  });
});
