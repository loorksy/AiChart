/**
 * The backtest cache — what makes a re-run a database read.
 *
 * The properties under test are the ones that decide whether a cache HELPS or
 * LIES. A key that ignored the spec revision would serve results for a strategy
 * that no longer exists. A key built from the bar range alone would collide
 * when the store backfilled a hole inside a window it already covered, and hand
 * back an answer from a run that never saw those bars. Both failures are silent
 * — the platform would keep quoting a win rate, just the wrong one.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "aichart-backtest-runner-"));
process.env.DB_PATH = join(dir, "runner.db");
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.APP_SECRET = "backtest-runner-secret";
delete process.env.DATABASE_URL;

let runner: typeof import("@/lib/strategies/backtestRunner");

const base = {
  strategyId: "ema_trend_follow_v1",
  specRevision: "6",
  timeframe: "1h",
  barsFrom: 1_700_000_000_000,
  barsTo: 1_800_000_000_000,
  barCount: 20_000,
};

before(async () => {
  const db = await import("@/lib/db");
  await db.initDb();
  runner = await import("@/lib/strategies/backtestRunner");
});

describe("the backtest cache key", () => {
  it("is stable for an identical claim", () => {
    assert.equal(runner.backtestCacheKey(base), runner.backtestCacheKey({ ...base }));
  });

  it("changes when the spec revision moves", () => {
    // A revision bump means the strategy's entry, exit or risk geometry
    // changed. Serving the old result would attribute one strategy's record to
    // a different strategy.
    assert.notEqual(
      runner.backtestCacheKey(base),
      runner.backtestCacheKey({ ...base, specRevision: "7" }),
    );
  });

  it("changes when the bar COUNT moves inside the same range", () => {
    // The failure this catches: a backfill fills a gap inside a window already
    // covered. The range is identical, the data is not.
    assert.notEqual(
      runner.backtestCacheKey(base),
      runner.backtestCacheKey({ ...base, barCount: base.barCount + 1 }),
    );
  });

  it("separates strategies and timeframes", () => {
    assert.notEqual(
      runner.backtestCacheKey(base),
      runner.backtestCacheKey({ ...base, strategyId: "range_breakout_v1" }),
    );
    assert.notEqual(
      runner.backtestCacheKey(base),
      runner.backtestCacheKey({ ...base, timeframe: "4h" }),
    );
  });
});

describe("submitting a backtest", () => {
  it("refuses an unknown strategy by name", async () => {
    const outcome = await runner.submitStrategyBacktest({
      userId: 1,
      requestId: "r1",
      strategyId: "not_a_real_strategy",
      timeframe: "1h",
    });
    assert.deepEqual(outcome, { status: "skipped", reason: "unknown_strategy" });
  });

  it("refuses a timeframe the store does not keep", async () => {
    const outcome = await runner.submitStrategyBacktest({
      userId: 1,
      requestId: "r2",
      strategyId: "ema_trend_follow_v1",
      timeframe: "1m",
    });
    assert.deepEqual(outcome, { status: "skipped", reason: "insufficient_bars" });
  });

  it("refuses to spend a research slot on a store too shallow to cite", async () => {
    // The store is empty in this test database. A job submitted over a handful
    // of bars produces a sample the evidence gate would refuse anyway.
    const outcome = await runner.submitStrategyBacktest({
      userId: 1,
      requestId: "r3",
      strategyId: "ema_trend_follow_v1",
      timeframe: "1h",
    });
    assert.deepEqual(outcome, { status: "skipped", reason: "insufficient_bars" });
  });
});

describe("settling a cached result", () => {
  it("round-trips a completed run", async () => {
    const cacheKey = runner.backtestCacheKey(base);
    // Seed a pending row the way a submission would.
    const db = await import("@/lib/db");
    await db.execute(
      `INSERT INTO backtest_results
         (cache_key, strategy_id, spec_revision, timeframe, bars_from, bars_to,
          bar_count, backtest_id, job_id, status, trade_count, win_rate,
          metrics_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,'{}',?,?)`,
      [
        cacheKey,
        base.strategyId,
        base.specRevision,
        base.timeframe,
        base.barsFrom,
        base.barsTo,
        base.barCount,
        null,
        "job-1",
        Date.now(),
        Date.now(),
      ],
    );

    const pending = await runner.readBacktestCache(cacheKey);
    assert.equal(pending?.status, "pending");
    assert.equal(pending?.tradeCount, null, "a pending run has no record to quote");

    await runner.settleBacktestCache({
      cacheKey,
      status: "complete",
      tradeCount: 214,
      winRate: 0.61,
    });
    const settled = await runner.readBacktestCache(cacheKey);
    assert.equal(settled?.status, "complete");
    assert.equal(settled?.tradeCount, 214);
    assert.equal(settled?.winRate, 0.61);
  });

  it("lists what it holds", async () => {
    const rows = await runner.listBacktestCache("1h");
    assert.ok(rows.length >= 1);
    assert.equal(rows[0]!.timeframe, "1h");
  });
});
