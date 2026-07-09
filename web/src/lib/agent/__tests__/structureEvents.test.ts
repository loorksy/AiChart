import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectStructureEvents } from "@/lib/agent/marketContext/structureEvents";
import type { AgentCandle, Swing } from "@/lib/agent/marketContext/detectors";

const BAR = 60_000;

function candle(
  i: number,
  o: number,
  h: number,
  l: number,
  c: number,
): AgentCandle {
  return { time: i * BAR, open: o, high: h, low: l, close: c };
}

/** 10 flat candles then a breaking candle at index 10 (+ follow-through). */
function seriesWithBreak(input: {
  level: number;
  direction: "up" | "down";
  closeBeyond: number;
}): AgentCandle[] {
  const out: AgentCandle[] = [];
  for (let i = 0; i < 10; i++) out.push(candle(i, 100, 100.5, 99.5, 100));
  const close =
    input.direction === "up"
      ? input.level + input.closeBeyond
      : input.level - input.closeBeyond;
  out.push(
    candle(10, 100, Math.max(100, close) + 0.1, Math.min(100, close) - 0.1, close),
  );
  // follow-through candle in the same direction
  const c2 = input.direction === "up" ? close + 0.4 : close - 0.4;
  out.push(candle(11, close, Math.max(close, c2), Math.min(close, c2), c2));
  return out;
}

describe("structureEvents", () => {
  it("detects a bullish BOS on a close above the swing high", () => {
    const swings: Swing[] = [{ type: "high", time: 5 * BAR, price: 101 }];
    const events = detectStructureEvents(
      seriesWithBreak({ level: 101, direction: "up", closeBeyond: 0.5 }),
      swings,
      1,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "BOS");
    assert.equal(events[0]!.direction, "bullish");
    assert.equal(events[0]!.brokenLevel, 101);
  });

  it("detects a bearish BOS on a close below the swing low", () => {
    const swings: Swing[] = [{ type: "low", time: 5 * BAR, price: 99 }];
    const events = detectStructureEvents(
      seriesWithBreak({ level: 99, direction: "down", closeBeyond: 0.5 }),
      swings,
      1,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "BOS");
    assert.equal(events[0]!.direction, "bearish");
  });

  it("detects CHoCH when a break goes AGAINST the running trend", () => {
    // First a bullish break (trend → bullish), then a bearish break → CHoCH.
    const candles: AgentCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 100.5, 99.5, 100));
    candles.push(candle(10, 100, 101.7, 99.9, 101.5)); // bullish break of 101
    for (let i = 11; i < 20; i++) candles.push(candle(i, 101, 101.5, 100.5, 101));
    candles.push(candle(20, 101, 101.2, 98.4, 98.6)); // bearish break of 99 (small body vs ATR would be MSS; keep displacement mild)
    const swings: Swing[] = [
      { type: "high", time: 5 * BAR, price: 101 },
      { type: "low", time: 15 * BAR, price: 99 },
    ];
    const events = detectStructureEvents(candles, swings, 2.5);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.type, "BOS");
    assert.equal(events[0]!.direction, "bullish");
    assert.equal(events[1]!.direction, "bearish");
    assert.ok(events[1]!.type === "CHoCH" || events[1]!.type === "MSS");
  });

  it("bullish CHoCH after a bearish trend", () => {
    const candles: AgentCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 100.5, 99.5, 100));
    candles.push(candle(10, 100, 100.1, 98.3, 98.5)); // bearish break of 99
    for (let i = 11; i < 20; i++) candles.push(candle(i, 99, 99.5, 98.5, 99));
    candles.push(candle(20, 99, 101.8, 98.9, 101.6)); // bullish break of 101
    const swings: Swing[] = [
      { type: "low", time: 5 * BAR, price: 99 },
      { type: "high", time: 15 * BAR, price: 101 },
    ];
    const events = detectStructureEvents(candles, swings, 2.5);
    assert.equal(events.length, 2);
    assert.equal(events[1]!.direction, "bullish");
    assert.ok(events[1]!.type === "CHoCH" || events[1]!.type === "MSS");
  });

  it("does NOT detect a break on a wick-only poke (close back inside)", () => {
    const candles: AgentCandle[] = [];
    for (let i = 0; i < 10; i++) candles.push(candle(i, 100, 100.5, 99.5, 100));
    // Wick above 101 but close back at 100.4 → sweep, not a break.
    candles.push(candle(10, 100, 101.6, 99.9, 100.4));
    const swings: Swing[] = [{ type: "high", time: 5 * BAR, price: 101 }];
    const events = detectStructureEvents(candles, swings, 1);
    assert.equal(events.length, 0);
  });
});
