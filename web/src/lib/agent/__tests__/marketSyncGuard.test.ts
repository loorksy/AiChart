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
  it("allows synchronized warehouse, live, and chart candles", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { time: T, close: 1.144 },
    });
    assert.equal(status.ok, true);
  });

  it("blocks stale warehouse candles versus live candles", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T - 3 * 60_000, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { time: T, close: 1.144 },
    });
    assert.equal(status.ok, false);
    assert.equal(status.warehouseLastTime, T - 3 * 60_000);
    assert.equal(status.liveLastTime, T);
  });

  it("blocks warehouse/live close mismatch beyond tolerance", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.143)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { time: T, close: 1.144 },
    });
    assert.equal(status.ok, false);
    assert.equal(status.warehouseClose, 1.143);
    assert.equal(status.liveClose, 1.144);
  });

  it("blocks chart/live close mismatch beyond tolerance", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { time: T, close: 1.145 },
    });
    assert.equal(status.ok, false);
    assert.equal(status.chartClose, 1.145);
    assert.equal(status.liveClose, 1.144);
  });

  it("blocks live fetch errors", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [],
      liveError: "upstream failed",
    });
    assert.equal(status.ok, false);
  });
});
