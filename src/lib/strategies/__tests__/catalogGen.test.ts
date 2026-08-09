import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GENERATED_CATALOG,
  GENERATED_CATALOG_BY_ID,
  SCALP_CATALOG,
  catalogEntriesForTimeframe,
} from "@/lib/strategies/catalogGen";
import {
  assessCostViability,
  riskPolicyFor,
  roundTripCostPips,
  styleForTimeframe,
} from "@/lib/strategies/riskPolicy";
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

const TIMEFRAMES: ResearchTimeframe[] = ["1m", "5m", "15m", "30m", "1h", "4h"];
const SCALP_TIMEFRAMES: ResearchTimeframe[] = ["1m", "5m", "15m"];

describe("generated catalog", () => {
  it("contains the planned family sizes (15 scalp + 60 general + 3 legacy)", () => {
    const byFamily = new Map<string, number>();
    for (const entry of GENERATED_CATALOG) {
      byFamily.set(entry.family, (byFamily.get(entry.family) ?? 0) + 1);
    }
    // Scalp-native families — the product's priority set.
    assert.equal(byFamily.get("scalp_micro_break"), 6);
    assert.equal(byFamily.get("scalp_quick_mr"), 4);
    assert.equal(byFamily.get("scalp_burst"), 3);
    assert.equal(byFamily.get("scalp_stretch_revert"), 2);
    assert.equal(SCALP_CATALOG.length, 15);
    // General families.
    assert.equal(byFamily.get("ema_cross"), 12);
    assert.equal(byFamily.get("ema_cross_rsi"), 6);
    assert.equal(byFamily.get("rsi_mr"), 12);
    assert.equal(byFamily.get("rsi_mr_trend"), 4);
    assert.equal(byFamily.get("breakout"), 18);
    assert.equal(byFamily.get("session_range"), 4);
    assert.equal(byFamily.get("atr_regime"), 4);
    assert.equal(GENERATED_CATALOG.length, 75);
    assert.equal(BACKTEST_STRATEGY_IDS.length, 78);
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

describe("scalp prioritisation", () => {
  it("classifies timeframes into trading styles", () => {
    assert.equal(styleForTimeframe("1m"), "scalp");
    assert.equal(styleForTimeframe("5m"), "scalp");
    assert.equal(styleForTimeframe("15m"), "intraday");
    assert.equal(styleForTimeframe("4h"), "swing");
  });

  it("scalp risk geometry is tighter and faster than swing", () => {
    const scalp = riskPolicyFor("1m");
    const swing = riskPolicyFor("4h");
    assert.ok(scalp.stopAtrMultiple < swing.stopAtrMultiple);
    assert.ok(scalp.targetR[0] < swing.targetR[0]);
    assert.ok(scalp.maximumHoldingBars < swing.maximumHoldingBars);
    assert.ok(scalp.breakEvenAtR <= swing.breakEvenAtR);
    // Scalping fires far more often — the daily cap must not truncate it.
    assert.ok(scalp.dailyTradeLimit > swing.dailyTradeLimit);
  });

  it("specs carry the timeframe's own risk geometry", () => {
    const costs = { spreadPips: 2, slippagePips: 1, commissionPerLotSideUsd: 0 };
    const build = (timeframe: ResearchTimeframe) =>
      buildBacktestStrategySpec({
        strategyId: "ema_trend_follow_v1",
        symbol: "XAUUSD",
        timeframe,
        costs,
      }) as Record<string, any>;

    const scalp = build("1m");
    const swing = build("4h");
    assert.equal(scalp.stop_loss.value, riskPolicyFor("1m").stopAtrMultiple);
    assert.equal(swing.stop_loss.value, riskPolicyFor("4h").stopAtrMultiple);
    assert.ok(scalp.management.maximum_holding_bars < swing.management.maximum_holding_bars);
    assert.ok(
      scalp.risk_controls.daily_trade_limit > swing.risk_controls.daily_trade_limit,
    );
    // Sizing split must still total 100% on every style.
    for (const spec of [scalp, swing]) {
      assert.equal(
        spec.targets.reduce((s: number, t: any) => s + t.size_percent, 0),
        100,
      );
    }
  });

  it("scalp frames get the scalp families; slow frames never do", () => {
    for (const timeframe of ["1m", "5m"] as ResearchTimeframe[]) {
      const ids = new Set(catalogEntriesForTimeframe(timeframe).map((e) => e.id));
      for (const entry of SCALP_CATALOG) {
        assert.ok(ids.has(entry.id), `${timeframe} must include ${entry.id}`);
      }
      // Structurally-too-slow parameters are excluded from scalp frames.
      assert.ok(![...ids].some((id) => id.includes("_50_200_")), timeframe);
      assert.ok(![...ids].some((id) => id.startsWith("brk_48_")), timeframe);
      assert.ok(![...ids].some((id) => id.startsWith("session_range")), timeframe);
    }
    for (const timeframe of ["1h", "4h"] as ResearchTimeframe[]) {
      const ids = new Set(catalogEntriesForTimeframe(timeframe).map((e) => e.id));
      for (const entry of SCALP_CATALOG) {
        assert.ok(!ids.has(entry.id), `${timeframe} must exclude ${entry.id}`);
      }
    }
  });

  it("cost viability rejects targets that cannot clear the round trip", () => {
    const costs = { spreadPips: 2, slippagePips: 1, commissionPerLotSideUsd: 0 };
    // Round trip = (2 + 1) × 2 = 6 pips; a viable first target needs ≥ 18.
    assert.equal(roundTripCostPips(costs), 6);

    // Gold 1m with a 3-pip ATR: 3 × 0.8 × 1.2 ≈ 2.9 pips — hopeless.
    const thin = assessCostViability("1m", costs, 3);
    assert.equal(thin.viable, false);
    assert.equal(thin.requiredTargetPips, 18);
    assert.match(thin.reason, /does not clear/);

    // With a 30-pip ATR: 30 × 0.8 × 1.2 = 28.8 pips — comfortably viable.
    assert.equal(assessCostViability("1m", costs, 30).viable, true);
  });
});

describe("pipeline targets and ranges", () => {
  it("wave matrix is timeframe-appropriate, not the full cross product", () => {
    const config = {
      userId: 1,
      symbols: ["XAUUSD"],
      timeframes: SCALP_TIMEFRAMES,
      batch: 2,
    };
    const targets = pipelineTargets(config);
    // Each timeframe contributes legacy(3) + its own filtered catalog.
    const expected = SCALP_TIMEFRAMES.reduce(
      (sum, tf) => sum + 3 + catalogEntriesForTimeframe(tf).length,
      0,
    );
    assert.equal(targets.length, expected);
    assert.ok(targets.length < 78 * SCALP_TIMEFRAMES.length, "must be filtered");
    // Deterministic ordering (stable ids for idempotency keys).
    assert.deepEqual(targets[0], {
      strategyId: "ema_trend_follow_v1",
      symbol: "XAUUSD",
      timeframe: "1m",
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

  it("config defaults prioritise scalp timeframes", () => {
    delete process.env.STRATEGY_PIPELINE_USER_ID;
    delete process.env.STRATEGY_PIPELINE_SYMBOLS;
    delete process.env.STRATEGY_PIPELINE_TIMEFRAMES;
    delete process.env.STRATEGY_PIPELINE_BATCH;
    const config = pipelineConfig();
    assert.equal(config.userId, null); // tick refuses to run without it
    assert.deepEqual(config.symbols, ["XAUUSD"]);
    assert.deepEqual(config.timeframes, ["1m", "5m", "15m"]);
    assert.equal(config.batch, 2);
  });
});
