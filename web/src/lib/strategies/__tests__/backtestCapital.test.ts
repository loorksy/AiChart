import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BACKTEST_NOTIONAL_CAPITAL,
  resolveBacktestNotionalCapital,
} from "@/lib/strategies/backtestCapital";

describe("resolveBacktestNotionalCapital", () => {
  it("defaults to 10000 when omitted", () => {
    assert.equal(resolveBacktestNotionalCapital(undefined), DEFAULT_BACKTEST_NOTIONAL_CAPITAL);
    assert.equal(resolveBacktestNotionalCapital(null), DEFAULT_BACKTEST_NOTIONAL_CAPITAL);
  });

  it("accepts an explicit simulation capital", () => {
    assert.equal(resolveBacktestNotionalCapital(25_000), 25_000);
  });

  it("rejects values outside the allowed simulation range", () => {
    assert.throws(() => resolveBacktestNotionalCapital(10), /notional_capital/);
    assert.throws(() => resolveBacktestNotionalCapital(20_000_000), /notional_capital/);
  });
});
