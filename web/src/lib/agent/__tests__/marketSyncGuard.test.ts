import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMarketSync } from "@/lib/agent/marketContext/marketSyncGuard";
import type { AgentCandle } from "@/lib/agent/marketContext/detectors";

const T = Date.UTC(2026, 0, 1, 12, 0, 0);

function candle(time: number, close: number): AgentCandle {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  };
}

describe("marketSyncGuard", () => {
  it("allows synchronized warehouse and live candles", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { time: T, close: 1.144 },
    });
    assert.equal(status.ok, true);
  });

  it("accepts recent warehouse when live fetch fails", () => {
    const status = evaluateMarketSync({
      symbol: "XAUUSD",
      interval: "15m",
      warehouseCandles: [candle(Date.now() - 60_000, 2650)],
      liveCandles: [],
      liveError: "upstream timeout",
    });
    assert.equal(status.ok, true);
    assert.match(status.reason, /warehouse/i);
  });

  it("blocks stale warehouse when live fetch fails", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T - 60 * 60_000, 1.144)],
      liveCandles: [],
      liveError: "upstream timeout",
    });
    assert.equal(status.ok, false);
  });

  it("allows warehouse-only when live is missing but warehouse is recent", () => {
    const now = Date.now();
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(now - 30_000, 1.144)],
      liveCandles: [],
    });
    assert.equal(status.ok, true);
  });

  it("accepts forming-bar close drift on the same bar", () => {
    const status = evaluateMarketSync({
      symbol: "XAUUSD",
      interval: "15m",
      warehouseCandles: [candle(T, 2650)],
      liveCandles: [candle(T, 2650.8)],
    });
    assert.equal(status.ok, true);
  });

  it("does not block analysis when the chart tail is stale", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { symbol: "GBPUSD", interval: "15m", time: T - 60_000, close: 1.2 },
    });
    assert.equal(status.ok, true);
  });

  it("blocks warehouse/live close mismatch on different bars", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T - 5 * 60_000, 1.143)],
      liveCandles: [candle(T, 1.144)],
    });
    assert.equal(status.ok, false);
  });
});
