import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  basketProfitDistance,
  breakEven,
  evaluateGrid,
  totalLot,
  type GridConfig,
  type GridLevel,
} from "../strategies/gridBot";

const baseSell: GridConfig = {
  side: "sell",
  initialLot: 0.01,
  gridStep: 2, // price units
  multiplier: 2,
  takeProfit: 1, // price units from break-even
  maxLevels: 5,
  maxTotalLot: 1,
  lotStep: 0.01,
};

describe("gridBot — break-even & totals", () => {
  it("weighted break-even across uneven lots", () => {
    const levels: GridLevel[] = [
      { price: 100, lot: 0.01 },
      { price: 104, lot: 0.02 },
    ];
    // (100*0.01 + 104*0.02) / 0.03 = (1 + 2.08)/0.03 = 102.666..
    assert.ok(Math.abs(breakEven(levels) - 102.6667) < 0.001);
    assert.equal(totalLot(levels), 0.03);
  });

  it("sell basket profit grows as price falls below break-even", () => {
    const levels: GridLevel[] = [{ price: 100, lot: 0.01 }];
    assert.ok(basketProfitDistance("sell", levels, { bid: 98, ask: 98.5 }) > 0);
    assert.ok(basketProfitDistance("sell", levels, { bid: 101, ask: 101.5 }) < 0);
  });
});

describe("gridBot — first order", () => {
  it("opens the initial order when the basket is empty", () => {
    const d = evaluateGrid(baseSell, [], { bid: 100, ask: 100.1 });
    assert.equal(d.action, "open");
    assert.equal(d.side, "sell");
    assert.equal(d.lot, 0.01);
    assert.equal(d.reason, "first_order");
  });
});

describe("gridBot — Martingale additions", () => {
  it("adds a multiplied level after an adverse step (sell: price rose)", () => {
    const levels: GridLevel[] = [{ price: 100, lot: 0.01 }];
    // price rose to 102 (>= step 2) → adverse for a sell → add 0.01 * 2^1 = 0.02
    const d = evaluateGrid(baseSell, levels, { bid: 102, ask: 102.1 });
    assert.equal(d.action, "open");
    assert.equal(d.lot, 0.02);
    assert.equal(d.reason, "grid_add");
  });

  it("holds when the adverse move is smaller than the grid step", () => {
    const levels: GridLevel[] = [{ price: 100, lot: 0.01 }];
    const d = evaluateGrid(baseSell, levels, { bid: 101, ask: 101.1 });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "waiting");
  });
});

describe("gridBot — SAFETY guardrails", () => {
  it("never exceeds maxLevels (the runaway-Martingale cap)", () => {
    const levels: GridLevel[] = Array.from({ length: 5 }, (_, i) => ({
      price: 100 + i * 2,
      lot: 0.01,
    }));
    const d = evaluateGrid(baseSell, levels, { bid: 120, ask: 120.1 });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "max_levels_reached");
  });

  it("never exceeds maxTotalLot", () => {
    const cfg = { ...baseSell, maxLevels: 50, maxTotalLot: 0.02 };
    const levels: GridLevel[] = [
      { price: 100, lot: 0.01 },
      { price: 102, lot: 0.005 },
    ];
    // next lot would be 0.01*2^2=0.04 → 0.015+0.04 > 0.02 → blocked
    const d = evaluateGrid(cfg, levels, { bid: 110, ask: 110.1 });
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "max_total_lot");
  });
});

describe("gridBot — basket take-profit", () => {
  it("closes all once aggregate profit reaches the target (sell)", () => {
    const levels: GridLevel[] = [
      { price: 100, lot: 0.01 },
      { price: 102, lot: 0.02 },
    ];
    // break-even ≈ 101.333; sell profit when ask <= be - tp(1) = 100.333
    const d = evaluateGrid(baseSell, levels, { bid: 100.0, ask: 100.2 });
    assert.equal(d.action, "close_all");
    assert.equal(d.reason, "take_profit");
  });

  it("take-profit takes priority over adding even after an adverse step", () => {
    // Construct a basket that is simultaneously in profit; TP must win.
    const levels: GridLevel[] = [{ price: 100, lot: 0.01 }];
    const d = evaluateGrid(baseSell, levels, { bid: 98, ask: 98.5 });
    assert.equal(d.action, "close_all");
  });
});

describe("gridBot — buy mirror", () => {
  const baseBuy: GridConfig = { ...baseSell, side: "buy" };
  it("buy basket adds when price falls a step, closes when it rises a target", () => {
    const levels: GridLevel[] = [{ price: 100, lot: 0.01 }];
    // price fell to 98 (adverse for buy) → add
    const add = evaluateGrid(baseBuy, levels, { bid: 97.9, ask: 98 });
    assert.equal(add.action, "open");
    assert.equal(add.reason, "grid_add");
    // price rose to 101.2 → buy profit (bid >= be + tp = 101) → close
    const tp = evaluateGrid(baseBuy, levels, { bid: 101.2, ask: 101.3 });
    assert.equal(tp.action, "close_all");
  });
});
