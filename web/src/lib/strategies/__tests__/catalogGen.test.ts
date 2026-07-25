import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERATED_CATALOG, GENERATED_CATALOG_BY_ID } from "@/lib/strategies/catalogGen";
import {
  BACKTEST_STRATEGY_IDS,
  CATALOG_SPEC_REVISION,
  LEGACY_STRATEGY_IDS,
  buildBacktestStrategySpec,
  isBacktestStrategyId,
} from "@/lib/strategies/catalog";
import { pipelineConfig, pipelineTargets, pipelineDateRange, MAX_BACKTEST_BARS } from "@/lib/strategies/pipeline";
import { barDurationMs } from "@/lib/intervals";
import type { ResearchTimeframe } from "@/lib/research";

/** MCP shape contract + research-service id pattern, both must accept every id. */
const MCP_ID_PATTERN = /^[a-z0-9_]+_v\d+$/;
const RESEARCH_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const SUPPORTED_LEAF_TYPES = new Set([
  "price_comparison",
  "ema_relation",
  "sma_relation",
  "rsi_threshold",
  "atr_threshold",
  "range_breakout",
  "market_session",
  "day_of_week",
  "time_window",
]);

const TIMEFRAMES: ResearchTimeframe[] = ["15m", "30m", "1h", "4h"];

describe("generated catalog", () => {
  it("contains the planned family sizes (60 generated + 3 legacy)", () => {
    const byFamily = new Map<string, number>();
    for (const entry of GENERATED_CATALOG) {
      byFamily.set(entry.family, (byFamily.get(entry.family) ?? 0) + 1);
    }
    assert.equal(byFamily.get("ema_cross"), 12);
    assert.equal(byFamily.get("ema_cross_rsi"), 6);
    assert.equal(byFamily.get("rsi_mr"), 12);
    assert.equal(byFamily.get("rsi_mr_trend"), 4);
    assert.equal(byFamily.get("breakout"), 18);
    assert.equal(byFamily.get("session_range"), 4);
    assert.equal(byFamily.get("atr_regime"), 4);
    assert.equal(GENERATED_CATALOG.length, 60);
    assert.equal(BACKTEST_STRATEGY_IDS.length, 63);
  });

  it("every id is unique and satisfies BOTH id contracts", () => {
    const ids = BACKTEST_STRATEGY_IDS;
    assert.equal(new Set(ids).size, ids.length, "duplicate strategy ids");
    for (const id of ids) {
      assert.match(id, MCP_ID_PATTERN, id);
      assert.match(id, RESEARCH_ID_PATTERN, id);
      assert.ok(id.length >= 3 && id.length <= 128, id);
    }
  });

  it("legacy ids remain members and resolve their original trees", () => {
    for (const id of LEGACY_STRATEGY_IDS) {
      assert.ok(isBacktestStrategyId(id), id);
      assert.ok(!GENERATED_CATALOG_BY_ID.has(id), `${id} must stay legacy`);
    }
    assert.ok(!isBacktestStrategyId("invented_edge_v9"));
  });

  it("every entry builds a spec whose leaves the research service supports", () => {
    const costs = { spreadPips: 2, slippagePips: 1, commissionPerLotSideUsd: 0 };
    for (const entry of GENERATED_CATALOG) {
      for (const timeframe of TIMEFRAMES) {
        const spec = buildBacktestStrategySpec({
          strategyId: entry.id,
          symbol: "XAUUSD",
          timeframe,
          costs,
        }) as Record<string, unknown>;

        assert.equal(spec.version_id, `${entry.id}.${CATALOG_SPEC_REVISION}`);

        for (const side of ["long_entry_conditions", "short_entry_conditions"]) {
          const tree = spec[side] as { all: Array<Record<string, unknown>> };
          assert.ok(Array.isArray(tree.all) && tree.all.length >= 1, entry.id);
          assert.ok(tree.all.length <= 4, `${entry.id}: tree too deep for v1`);
          for (const leaf of tree.all) {
            assert.ok(
              SUPPORTED_LEAF_TYPES.has(String(leaf.type)),
              `${entry.id}: unsupported leaf ${String(leaf.type)}`,
            );
            // Leaves with a timeframe must use the entry timeframe (no HTF
            // refs — spec.timeframes.higher is empty).
            if ("timeframe" in leaf) {
              assert.equal(leaf.timeframe, timeframe, entry.id);
            }
            if (leaf.type === "range_breakout") {
              const lookback = Number(leaf.lookback_bars);
              assert.ok(lookback >= 2 && lookback <= 10_000, entry.id);
            }
            if (leaf.type === "sma_relation" || leaf.type === "ema_relation") {
              assert.ok(
                Number(leaf.fast_period) < Number(leaf.slow_period),
                `${entry.id}: fast must be < slow`,
              );
            }
          }
        }

        // Shared risk policy invariants (the gates depend on them).
        const targets = spec.targets as Array<{ size_percent: number }>;
        assert.equal(
          targets.reduce((sum, t) => sum + t.size_percent, 0),
          100,
        );
      }
    }
  });

  it("spec generation is deterministic", () => {
    const costs = { spreadPips: 2, slippagePips: 1, commissionPerLotSideUsd: 0 };
    const first = JSON.stringify(
      buildBacktestStrategySpec({ strategyId: "brk_20_cls_lo_v1", symbol: "XAUUSD", timeframe: "1h", costs }),
    );
    const second = JSON.stringify(
      buildBacktestStrategySpec({ strategyId: "brk_20_cls_lo_v1", symbol: "XAUUSD", timeframe: "1h", costs }),
    );
    assert.equal(first, second);
  });
});

describe("pipeline targets and ranges", () => {
  it("wave 1 matrix = catalog × XAUUSD × 4 timeframes", () => {
    const config = {
      userId: 1,
      symbols: ["XAUUSD"],
      timeframes: TIMEFRAMES,
      batch: 2,
    };
    const targets = pipelineTargets(config);
    assert.equal(targets.length, 63 * 4);
    // Deterministic ordering (stable ids for idempotency keys).
    assert.deepEqual(targets[0], {
      strategyId: "ema_trend_follow_v1",
      symbol: "XAUUSD",
      timeframe: "15m",
    });
  });

  it("every pipeline date range fits the 50k-bar export budget", () => {
    for (const timeframe of TIMEFRAMES) {
      const { fromMs, toMs } = pipelineDateRange(timeframe);
      const bars = Math.ceil((toMs - fromMs) / barDurationMs(timeframe));
      assert.ok(bars <= MAX_BACKTEST_BARS, `${timeframe}: ${bars} bars`);
      assert.ok(toMs < Date.now(), "range must end in the past");
      // And is deep enough to plausibly clear the 100-trade gate.
      assert.ok(bars >= 5_000, `${timeframe}: ${bars} bars is too shallow`);
    }
  });

  it("config defaults are safe without env", () => {
    delete process.env.STRATEGY_PIPELINE_USER_ID;
    delete process.env.STRATEGY_PIPELINE_SYMBOLS;
    delete process.env.STRATEGY_PIPELINE_TIMEFRAMES;
    delete process.env.STRATEGY_PIPELINE_BATCH;
    const config = pipelineConfig();
    assert.equal(config.userId, null); // tick refuses to run without it
    assert.deepEqual(config.symbols, ["XAUUSD"]);
    assert.deepEqual(config.timeframes, ["15m", "30m", "1h", "4h"]);
    assert.equal(config.batch, 2);
  });
});
