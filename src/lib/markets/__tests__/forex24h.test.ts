import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import {
  MS_24H,
  highLowFromWindow,
} from "@/lib/markets/forex24h";

const HOUR_MS = 3_600_000;

function hourlyCandles(count: number, startMs: number, highOffset = 1): OhlcCandle[] {
  const candles: OhlcCandle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 1.1 + i * 0.001;
    candles.push({
      time: startMs + i * HOUR_MS,
      open: base,
      high: base + highOffset,
      low: base - 0.5,
      close: base + 0.1,
    });
  }
  return candles;
}

function fourHourlyCandles(count: number, startMs: number): OhlcCandle[] {
  const candles: OhlcCandle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 1.1 + i * 0.01;
    candles.push({
      time: startMs + i * 4 * HOUR_MS,
      open: base,
      high: base + 10,
      low: base - 10,
      close: base,
    });
  }
  return candles;
}

describe("forex24h highLowFromWindow", () => {
  it("uses timestamp window (24h) not fixed bar count", () => {
    const anchorMs = 1_700_000_000_000;
    const candles = hourlyCandles(48, anchorMs - 47 * HOUR_MS);
    const cutoff = anchorMs - MS_24H;

    const { high24h, low24h } = highLowFromWindow(candles, cutoff);
    assert.ok(high24h !== null && low24h !== null);

    const window = candles.filter((c) => c.time >= cutoff);
    assert.ok(window.length >= 24 && window.length <= 25);
    assert.equal(high24h, Math.max(...window.map((c) => c.high)));
    assert.equal(low24h, Math.min(...window.map((c) => c.low)));
  });

  it("4h last-24-bars spans 96h — timestamp window is narrower", () => {
    const anchorMs = 1_700_000_000_000;
    const candles = fourHourlyCandles(30, anchorMs - 29 * 4 * HOUR_MS);
    for (let i = 0; i < 18; i++) {
      candles[i]!.high = 999;
    }
    const cutoff = anchorMs - MS_24H;

    const barSliceHigh = Math.max(...candles.slice(-24).map((c) => c.high));
    const { high24h } = highLowFromWindow(candles, cutoff);

    assert.ok(high24h !== null);
    assert.equal(barSliceHigh, 999);
    assert.ok(high24h! < 100);
    const window = candles.filter((c) => c.time >= cutoff);
    assert.ok(window.length <= 7);
    assert.equal(high24h, Math.max(...window.map((c) => c.high)));
  });

  it("returns refClose from candle at or before cutoff", () => {
    const anchorMs = 1_700_000_000_000;
    const candles = hourlyCandles(30, anchorMs - 29 * HOUR_MS);
    const cutoff = anchorMs - MS_24H;
    const { refClose } = highLowFromWindow(candles, cutoff);
    const atOrBefore = candles.filter((c) => c.time <= cutoff);
    assert.equal(refClose, atOrBefore[atOrBefore.length - 1]?.close ?? null);
  });
});
