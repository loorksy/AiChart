import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  backtestQuantStrategy,
  calibrateQuantAnalysisThresholds,
  normalizeQuantBacktestResult,
  validateQuantAnalyses,
} from "../client";
import { QuantAgentServiceError } from "../errors";
import type { QuantBacktestResultWire } from "../types";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function enable(): void {
  process.env.QUANT_AGENT_SERVICE_ENABLED = "1";
  process.env.QUANT_AGENT_SERVICE_URL = "http://quant-agent.internal:8091";
  process.env.QUANT_AGENT_SERVICE_INTERNAL_TOKEN = "server-secret-token-32-characters";
}

test("normalizeQuantBacktestResult: decodes the wire snake_case shape into camelCase, mapping missing fields to null", () => {
  const wire: QuantBacktestResultWire = {
    status: "completed",
    metrics: {
      trade_count: 42,
      win_rate: 0.55,
      profit_factor: 1.8,
      expectancy_r: 0.2,
      max_drawdown_r: -3.5,
      max_drawdown_percent: 15,
      sharpe_r: 1.1,
      metric_reasons: {},
    },
    warnings: null,
    error: null,
  };
  const result = normalizeQuantBacktestResult(wire);
  assert.equal(result.status, "completed");
  assert.equal(result.metrics?.tradeCount, 42);
  assert.equal(result.metrics?.winRate, 0.55);
  assert.equal(result.metrics?.profitFactor, 1.8);
  assert.equal(result.metrics?.expectancyR, 0.2);
  assert.equal(result.metrics?.maxDrawdownR, -3.5);
  assert.equal(result.metrics?.maxDrawdownPercent, 15);
  assert.equal(result.metrics?.sharpeR, 1.1);
  assert.deepEqual(result.metrics?.metricReasons, {});
  assert.equal(result.warnings, null);
  assert.equal(result.error, null);
});

test("normalizeQuantBacktestResult: null metrics (invalid backtest) stay null, never fabricated", () => {
  const wire: QuantBacktestResultWire = {
    status: "invalid",
    metrics: null,
    warnings: ["fewer than 30 trades"],
    error: "insufficient trade history",
  };
  const result = normalizeQuantBacktestResult(wire);
  assert.equal(result.status, "invalid");
  assert.equal(result.metrics, null);
  assert.deepEqual(result.warnings, ["fewer than 30 trades"]);
  assert.equal(result.error, "insufficient trade history");
});

test("backtestQuantStrategy: posts to the strategy-scoped backtest endpoint with the exact contract body", async () => {
  enable();
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init || {} };
    return Response.json({
      status: "completed",
      metrics: {
        trade_count: 31,
        win_rate: 0.5,
        profit_factor: 1.3,
        expectancy_r: 0.1,
        max_drawdown_r: -2,
        max_drawdown_percent: 20,
        sharpe_r: 0.8,
        metric_reasons: {},
      },
      warnings: null,
      error: null,
    } satisfies QuantBacktestResultWire);
  };

  const result = await backtestQuantStrategy(
    { userId: 7, requestId: "req-bt-1" },
    {
      strategyId: "ema_trend_v1",
      symbol: "EURUSD",
      market: "forex",
      interval: "1h",
      bars: [
        { time: 1_700_000_000_000, open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: 100 },
        { time: 1_700_000_060_000, open: 1.15, high: 1.16, low: 1.1, close: 1.12 },
      ],
    },
  );

  assert.equal(captured?.url, "http://quant-agent.internal:8091/internal/quant-agent/strategies/ema_trend_v1/backtest");
  assert.equal(captured?.init.method, "POST");
  const headers = captured?.init.headers as Record<string, string>;
  assert.equal(headers["X-AiChart-User-Id"], "7");
  assert.equal(headers["X-AiChart-Request-Id"], "req-bt-1");
  assert.equal(headers.Authorization, "Bearer server-secret-token-32-characters");

  const body = JSON.parse(String(captured?.init.body)) as {
    bars: { time: string; open: number; volume: number | null }[];
    symbol: string;
    market: string;
    interval: string;
    owner_user_id: number;
    request_id: string;
  };
  assert.equal(body.symbol, "EURUSD");
  assert.equal(body.market, "forex");
  assert.equal(body.interval, "1h");
  assert.equal(body.owner_user_id, 7);
  assert.equal(body.request_id, "req-bt-1");
  assert.equal(body.bars.length, 2);
  // `time` is converted from epoch milliseconds (the client's own QuantOhlcBar
  // convention everywhere else) to ISO 8601, per the contract's `ISO8601_str`.
  assert.equal(body.bars[0]!.time, new Date(1_700_000_000_000).toISOString());
  assert.equal(body.bars[0]!.volume, 100);
  // A bar with no volume is sent as an explicit null, never dropped or NaN.
  assert.equal(body.bars[1]!.volume, null);

  assert.equal(result.status, "completed");
  assert.equal(result.metrics?.tradeCount, 31);
  assert.equal(result.metrics?.profitFactor, 1.3);
});

test("backtestQuantStrategy: disabled feature makes no network call", async () => {
  delete process.env.QUANT_AGENT_SERVICE_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  await assert.rejects(
    backtestQuantStrategy(
      { userId: 1, requestId: "req-disabled" },
      { strategyId: "s1", symbol: "EURUSD", market: "forex", interval: "1h", bars: [] },
    ),
    (error: unknown) => error instanceof QuantAgentServiceError && error.code === "QUANT_AGENT_SERVICE_DISABLED",
  );
  assert.equal(called, false);
});

test("backtestQuantStrategy: normalizes a non-2xx response into QuantAgentServiceError", async () => {
  enable();
  globalThis.fetch = async () => Response.json({ error: { code: "STRATEGY_NOT_FOUND", message: "no such strategy" } }, { status: 404 });
  await assert.rejects(
    backtestQuantStrategy(
      { userId: 1, requestId: "req-404" },
      { strategyId: "missing", symbol: "EURUSD", market: "forex", interval: "1h", bars: [] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof QuantAgentServiceError);
      assert.equal(error.status, 404);
      return true;
    },
  );
});

/*
 * Wave 2's two validation/calibration calls. Their whole job is the snake_case
 * ↔ camelCase translation either side of the split, and a decoder that reads
 * `o.was_correct` as `undefined` produces a confident `wasCorrect: undefined`
 * that the cron would happily write back as "not correct". Nothing else in the
 * tree exercises them: the cron route has no test of its own.
 */

test("validateQuantAnalyses: posts the service's field names and decodes the outcomes back", async () => {
  enable();
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init || {} };
    return Response.json({
      results: [
        { id: "a1", was_correct: true, return_pct: 3.5 },
        { id: "a2", was_correct: false, return_pct: -0.25 },
      ],
      skipped: [{ id: "a3", reason: "non_positive_price" }],
      stats: { validated: 2, correct: 1, incorrect: 1, skipped: 1 },
    });
  };

  const result = await validateQuantAnalyses({ userId: 9, requestId: "req-val-1" }, [
    { id: "a1", decision: "BUY", priceAtAnalysis: 100, currentPrice: 103.5 },
    { id: "a2", decision: "SELL", priceAtAnalysis: 100, currentPrice: 99.75 },
    { id: "a3", decision: "HOLD", priceAtAnalysis: 0, currentPrice: 99 },
  ]);

  assert.equal(
    captured?.url,
    "http://quant-agent.internal:8091/internal/quant-agent/analysis/validate",
  );
  const body = JSON.parse(String(captured?.init.body)) as {
    analyses: { id: string; decision: string; price_at_analysis: number; current_price: number }[];
  };
  assert.deepEqual(body.analyses[0], {
    id: "a1",
    decision: "BUY",
    price_at_analysis: 100,
    current_price: 103.5,
  });

  // The decode is the point: a `wasCorrect` of `undefined` here would be
  // written back to the row as "not correct".
  assert.deepEqual(result.results, [
    { id: "a1", wasCorrect: true, returnPct: 3.5 },
    { id: "a2", wasCorrect: false, returnPct: -0.25 },
  ]);
  assert.deepEqual(result.skipped, [{ id: "a3", reason: "non_positive_price" }]);
  assert.equal(result.stats.validated, 2);
  assert.equal(result.stats.skipped, 1);
});

test("calibrateQuantAnalysisThresholds: decodes the report, including a non-applied one", async () => {
  enable();
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init || {} };
    return Response.json({
      thresholds: {
        buy_threshold: 20,
        sell_threshold: -20,
        min_consensus_abs_override: 15,
        quality_hold_threshold: 0.7,
      },
      applied: false,
      reason: "too_few_samples",
      best_accuracy: null,
      coverage: {},
      sample_count: 1,
      confidence_accuracy: {},
    });
  };

  const report = await calibrateQuantAnalysisThresholds({ userId: 9, requestId: "req-cal-1" }, [
    { consensusScore: 30, actualReturnPct: 3, confidence: 70, wasCorrect: true },
  ]);

  assert.equal(
    captured?.url,
    "http://quant-agent.internal:8091/internal/quant-agent/analysis/calibrate",
  );
  const body = JSON.parse(String(captured?.init.body)) as {
    samples: {
      consensus_score: number;
      actual_return_pct: number;
      confidence: number | null;
      was_correct: boolean | null;
    }[];
  };
  assert.deepEqual(body.samples[0], {
    consensus_score: 30,
    actual_return_pct: 3,
    confidence: 70,
    was_correct: true,
  });

  // `applied: false` must survive the decode — an operator reading `true` here
  // would believe a threshold search ran on one sample.
  assert.equal(report.applied, false);
  assert.equal(report.reason, "too_few_samples");
  assert.equal(report.bestAccuracy, null);
  assert.equal(report.sampleCount, 1);
  assert.equal(report.thresholds.buyThreshold, 20);
  assert.equal(report.thresholds.sellThreshold, -20);
  assert.equal(report.thresholds.minConsensusAbsOverride, 15);
  assert.equal(report.thresholds.qualityHoldThreshold, 0.7);
});

test("validateQuantAnalyses: disabled feature makes no network call", async () => {
  delete process.env.QUANT_AGENT_SERVICE_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  await assert.rejects(
    validateQuantAnalyses({ userId: 1, requestId: "req-val-off" }, []),
    (error: unknown) =>
      error instanceof QuantAgentServiceError && error.code === "QUANT_AGENT_SERVICE_DISABLED",
  );
  assert.equal(called, false);
});
