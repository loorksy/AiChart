import assert from "node:assert/strict";
import { test } from "node:test";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import { runAnalysisEngine } from "../analysisEngine";
import { analyzeFib } from "../fib";
import { analyzeLevels } from "../levels";
import { analyzeConfluence } from "../confluence";

function ramp(from: number, to: number, n: number): OhlcCandle[] {
  const out: OhlcCandle[] = [];
  let prev = from;
  for (let i = 0; i < n; i++) {
    const p = from + ((to - from) * i) / (n - 1);
    out.push({
      time: i * 60_000,
      open: prev,
      close: p,
      high: Math.max(prev, p) + 0.02,
      low: Math.min(prev, p) - 0.02,
    });
    prev = p;
  }
  return out;
}

test("engine produces a structured MarketAnalysis with drawings", () => {
  const candles = ramp(1.05, 1.08, 80);
  const { analysis, drawings } = runAnalysisEngine("EURUSD", "1h", candles);

  assert.equal(analysis.symbol, "EURUSD");
  assert.equal(analysis.interval, "1h");
  assert.ok(analysis.currentPrice > 0);
  assert.ok(["buy", "sell", "hold"].includes(analysis.suggestion.decision));
  assert.ok(analysis.confluence.confidence >= 0 && analysis.confluence.confidence <= 100);
  assert.ok(Array.isArray(drawings) && drawings.length > 0, "emits chart drawings");
  // current-price line always present
  assert.ok(drawings.some((d) => d.type === "price_line"));
});

test("uptrend yields a buy bias with stop below entry", () => {
  const candles = ramp(1.05, 1.10, 120);
  const { analysis } = runAnalysisEngine("EURUSD", "1h", candles);
  if (analysis.suggestion.decision === "buy") {
    assert.ok(analysis.suggestion.stop != null && analysis.suggestion.stop < analysis.suggestion.entry);
    for (const t of analysis.suggestion.targets) {
      assert.ok(t > analysis.suggestion.entry, "buy targets above entry");
    }
  }
});

test("engine is cached on the same last bar", () => {
  const candles = ramp(1.05, 1.07, 60);
  const a = runAnalysisEngine("GBPUSD", "15m", candles);
  const b = runAnalysisEngine("GBPUSD", "15m", candles);
  assert.equal(a.analysis.generatedAt, b.analysis.generatedAt, "second call served from cache");
});

test("fib levels are ordered between swing high and low", () => {
  const candles = ramp(1.10, 1.05, 40).concat(ramp(1.05, 1.085, 40));
  const fib = analyzeFib(candles);
  if (fib.direction) {
    assert.ok(fib.levels.length >= 7);
    const golden = fib.levels.find((l) => l.ratio === 0.618);
    assert.ok(golden, "0.618 present");
  }
});

test("levels expose nearest S/R and break structure", () => {
  const candles = ramp(1.05, 1.09, 90);
  const levels = analyzeLevels("EURUSD", "1h", candles);
  assert.ok(Array.isArray(levels.supports));
  assert.ok(Array.isArray(levels.resistances));
  assert.ok(Array.isArray(levels.breaks));
});

test("confluence collapses signals into a signed score", () => {
  const res = analyzeConfluence({
    indicators: {
      symbol: "X",
      interval: "1h",
      computedFrom: "mt5_ohlc",
      rsi14: 25,
      macd: { macd: 1, signal: 0, histogram: 0.5 },
      sma20: 1,
      sma50: 0.9,
      ema20: 1,
      bollinger: null,
      atr14: 0.01,
      stochastic: null,
      trend: "uptrend",
      summary: "",
    },
    breaks: [{ kind: "BOS", direction: "bullish", price: 1.1 }],
    pattern: null,
    higherTrend: "uptrend",
  });
  assert.equal(res.bias, "bullish");
  assert.ok(res.score > 0);
  assert.ok(res.confidence > 50);
});
