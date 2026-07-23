import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATALOG_SPEC_REVISION,
  buildBacktestStrategySpec,
} from "../catalog";

describe("catalog strategy entry policy", () => {
  it("allows re-entry after close for ema_trend_follow_v1 (not one-trade-ever)", () => {
    const spec = buildBacktestStrategySpec({
      strategyId: "ema_trend_follow_v1",
      symbol: "XAUUSD",
      timeframe: "1h",
      costs: { spreadPips: 2, slippagePips: 1, commissionPerLotSideUsd: 0 },
    });
    const entry = spec.entry as { allow_reentry?: boolean };
    const risk = spec.risk_controls as {
      max_open_positions?: number;
      max_positions_per_symbol?: number;
    };
    const management = spec.management as { maximum_holding_bars?: number };
    const longAll = (
      spec.long_entry_conditions as { all?: Array<{ type?: string }> }
    ).all;
    assert.equal(spec.version_id, `ema_trend_follow_v1.${CATALOG_SPEC_REVISION}`);
    assert.equal(entry.allow_reentry, true);
    assert.equal(risk.max_open_positions, 1);
    assert.equal(risk.max_positions_per_symbol, 1);
    assert.equal(management.maximum_holding_bars, 18);
    // Pure EMA cross — no RSI filter that previously suppressed most signals.
    assert.ok(longAll?.every((c) => c.type === "ema_relation"));
    assert.ok(!JSON.stringify(spec).includes("rsi_threshold"));
  });
});
