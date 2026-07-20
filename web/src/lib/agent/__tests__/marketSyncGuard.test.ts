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

  it("allows chart/live close drift on the same forming bar", () => {
    const status = evaluateMarketSync({
      symbol: "XAUUSD",
      interval: "15m",
      warehouseCandles: [candle(T, 2650)],
      liveCandles: [candle(T, 2650.8)],
      chartLatestCandle: { symbol: "XAUUSD", interval: "15m", time: T, close: 2650.2 },
    });
    assert.equal(status.ok, true);
  });

  it("blocks chart/live close mismatch on different bars", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { time: T - 3 * 60_000, close: 1.145 },
    });
    assert.equal(status.ok, false);
    assert.equal(status.chartClose, 1.145);
    assert.equal(status.liveClose, 1.144);
  });

  it("rejects a chart symbol that differs from the analyzed symbol", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { symbol: "GBPUSD", interval: "1m", time: T, close: 1.144 },
    });
    assert.equal(status.ok, false);
    assert.match(status.reason, /رمز الشارت/);
  });

  it("rejects a chart interval that differs from the analyzed interval", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { symbol: "EURUSD", interval: "15m", time: T, close: 1.144 },
    });
    assert.equal(status.ok, false);
    assert.match(status.reason, /فريم الشارت/);
  });

  it("allows a chart candle carrying a matching symbol/interval (namespaced)", () => {
    const status = evaluateMarketSync({
      symbol: "EURUSD",
      interval: "1m",
      warehouseCandles: [candle(T, 1.144)],
      liveCandles: [candle(T, 1.144)],
      chartLatestCandle: { symbol: "EA:EURUSD", interval: "1m", time: T, close: 1.144 },
    });
    assert.equal(status.ok, true);
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
