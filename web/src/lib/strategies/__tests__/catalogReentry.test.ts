import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBacktestStrategySpec } from "../catalog";

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
    assert.equal(entry.allow_reentry, true);
    assert.equal(risk.max_open_positions, 1);
    assert.equal(risk.max_positions_per_symbol, 1);
  });
});
