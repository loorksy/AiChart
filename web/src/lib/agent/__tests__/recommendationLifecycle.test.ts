import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRecommendationStatus } from "@/lib/agent/recommendation/evaluateRecommendationStatus";
import {
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
    targets: [102],
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
  it("keeps a recommendation pending before entry touch", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(0, 101, 101.2, 100.5, 101)]),
    });
    assert.equal(status.status, "pending_entry");
    assert.equal(status.triggered, false);
  });

  it("marks a recommendation triggered after entry touch", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(0, 101, 101.2, 99.8, 100.5)]),
    });
    assert.equal(status.status, "triggered");
    assert.equal(status.triggered, true);
  });

  it("marks target hits after entry trigger", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(0, 101, 102.1, 99.8, 101.5)]),
    });
    assert.equal(status.status, "tp1_hit");
    assert.equal(status.hitTarget, 1);
  });

  it("marks stop hits after entry trigger", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec({ invalidationLevel: 98.5 }),
      market: market([candle(0, 101, 101.2, 98.9, 99.2)]),
    });
    assert.equal(status.status, "sl_hit");
  });

  it("marks invalidation on a close beyond the invalidation level", () => {
    const status = evaluateRecommendationStatus({
      recommendation: rec(),
      market: market([candle(0, 101, 101.2, 98.8, 98.9)]),
    });
    assert.equal(status.status, "invalidated");
    assert.equal(status.invalidated, true);
  });
});
