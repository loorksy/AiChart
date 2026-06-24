import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  breakEven,
  evaluateGoldGrid,
  pipsToPrice,
  totalLot,
} from "../goldGridBot";
import { DEFAULT_GOLD_CONFIG } from "../goldDefaults";

const quote = { bid: 2650, ask: 2650.2 };
const mid = (quote.bid + quote.ask) / 2;
const gridStep = pipsToPrice(DEFAULT_GOLD_CONFIG.gridStepPips, mid);
const takeProfit = pipsToPrice(DEFAULT_GOLD_CONFIG.takeProfitPips, mid);

describe("goldGridBot — pips conversion", () => {
  it("converts XAUUSD pips to price units", () => {
    assert.ok(Math.abs(pipsToPrice(200, 2650) - 2) < 0.01);
    assert.ok(Math.abs(pipsToPrice(100, 2650) - 1) < 0.01);
  });
});

describe("goldGridBot — first order", () => {
  it("opens initial lot capped by maxLotCap", () => {
    const cfg = { ...DEFAULT_GOLD_CONFIG, initialLot: 0.1, maxLotCap: 0.04 };
    const d = evaluateGoldGrid(cfg, [], quote);
    assert.equal(d.action, "open");
    assert.equal(d.lot, 0.04);
    assert.equal(d.reason, "first_order");
  });
});

describe("goldGridBot — grid add & TP", () => {
  it("adds multiplied level after adverse move", () => {
    const levels = [{ price: quote.bid, lot: 0.01 }];
    const adverseBid = quote.bid + gridStep;
    const d = evaluateGoldGrid(
      DEFAULT_GOLD_CONFIG,
      levels,
      { bid: adverseBid, ask: adverseBid + 0.2 },
      "sell",
    );
    assert.equal(d.action, "open");
    assert.equal(d.lot, 0.02);
    assert.equal(d.reason, "grid_add");
  });

  it("closes basket at take-profit distance", () => {
    const levels = [
      { price: 2650, lot: 0.01 },
      { price: 2650 + gridStep, lot: 0.02 },
    ];
    const be = breakEven(levels);
    assert.ok(be > 0);
    const closeAsk = be - takeProfit - 0.05;
    const d = evaluateGoldGrid(
      DEFAULT_GOLD_CONFIG,
      levels,
      { bid: closeAsk - 0.1, ask: closeAsk },
      "sell",
    );
    assert.equal(d.action, "close_all");
    assert.equal(d.reason, "take_profit");
  });
});

describe("goldGridBot — safety caps", () => {
  it("respects maxLevels", () => {
    const levels = Array.from({ length: 5 }, (_, i) => ({
      price: 2650 + i * gridStep,
      lot: 0.01,
    }));
    const d = evaluateGoldGrid(
      DEFAULT_GOLD_CONFIG,
      levels,
      { bid: 2650 + 10 * gridStep, ask: 2650 + 10 * gridStep + 0.2 },
      "sell",
    );
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "max_levels_reached");
  });

  it("respects maxTotalLot", () => {
    const cfg = { ...DEFAULT_GOLD_CONFIG, maxLevels: 20, maxTotalLot: 0.02 };
    const levels = [
      { price: 2650, lot: 0.01 },
      { price: 2650 + gridStep, lot: 0.005 },
    ];
    assert.equal(totalLot(levels), 0.015);
    const d = evaluateGoldGrid(
      cfg,
      levels,
      { bid: 2650 + 2 * gridStep, ask: 2650 + 2 * gridStep + 0.2 },
      "sell",
    );
    assert.equal(d.action, "hold");
    assert.equal(d.reason, "max_total_lot");
  });
});
