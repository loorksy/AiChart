import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCALP_GEOMETRY,
  classifyActivation,
  computeGrossR,
  computeNetR,
  levelOrderValid,
  meetsExecutableGeometry,
  roundToTick,
  scorePlanGeometryQuality,
} from "@/lib/agent/trading/scalpGeometry";
import { analyzePathToEntry } from "@/lib/agent/trading/pathToEntry";
import { validateTradeSetup } from "@/lib/agent/risk/validateTradeSetup";

describe("scalp geometry contract", () => {
  it("rejects weak net-R sells as non-executable", () => {
    const geometry = meetsExecutableGeometry({
      action: "sell",
      entry: 3981.675,
      stop: 3982.7835,
      targets: [3980.84],
      spread: 0.2,
      meta: { tickSize: 0.01, digits: 2 },
    });
    const gross = computeGrossR({
      entry: 3981.675,
      stop: 3982.7835,
      target: 3980.84,
    });
    assert.ok(gross < 1, `gross R ${gross} should be ~0.75`);
    assert.equal(geometry.ok, false);
    assert.equal(geometry.reason, "tp1_net_r_below_minimum");
    assert.ok(geometry.netTp1R < SCALP_GEOMETRY.minNetTp1R);
  });

  it("ranks stronger geometry above weak geometry", () => {
    const weak = scorePlanGeometryQuality({
      netTp1R: 0.75,
      netTp2R: null,
      activationDistanceAtr: 3,
      structuralTargetCount: 1,
    });
    const strong = scorePlanGeometryQuality({
      netTp1R: 2.8,
      netTp2R: 4.5,
      activationDistanceAtr: 0.2,
      structuralTargetCount: 3,
    });
    assert.ok(strong > weak);
  });

  it("spread and slippage reduce effective R correctly", () => {
    const gross = computeGrossR({ entry: 100, stop: 98, target: 105 });
    const net = computeNetR({
      action: "buy",
      entry: 100,
      stop: 98,
      target: 105,
      spread: 0.4,
    });
    assert.equal(gross, 2.5);
    assert.ok(net < gross);
    assert.ok(net > 0);
  });

  it("enforces buy/sell level order", () => {
    assert.equal(
      levelOrderValid({ action: "sell", entry: 10, stop: 11, targets: [9] }),
      true,
    );
    assert.equal(
      levelOrderValid({ action: "sell", entry: 10, stop: 9, targets: [8] }),
      false,
    );
    assert.equal(
      levelOrderValid({ action: "buy", entry: 10, stop: 9, targets: [11] }),
      true,
    );
    assert.equal(
      levelOrderValid({ action: "buy", entry: 10, stop: 11, targets: [12] }),
      false,
    );
  });

  it("classifies distant pending entries as conditional", () => {
    const cls = classifyActivation({
      entry: 3981.675,
      currentPrice: 3975.26,
      atr: 1.5,
      entryType: "sell_limit",
    });
    assert.equal(cls, "conditional");
  });

  it("respects symbol tick conventions", () => {
    assert.equal(roundToTick(3981.675, { tickSize: 0.01, digits: 2 }), 3981.68);
    assert.equal(roundToTick(1.08543, { tickSize: 0.00001, digits: 5 }), 1.08543);
    assert.equal(roundToTick(149.123, { tickSize: 0.001, digits: 3 }), 149.123);
  });
});

describe("validateTradeSetup geometry gate", () => {
  it("rejects weak TP1 below minimum net R for execution", () => {
    const result = validateTradeSetup({
      currentPrice: 3975.26,
      dataSufficient: true,
      trade: {
        action: "sell",
        entry: 3981.675,
        stop_loss: 3982.7835,
        targets: [3980.84],
      },
      spread: 0.2,
    });
    assert.equal(result.accepted, false);
    assert.ok((result.netRr ?? 0) < SCALP_GEOMETRY.minNetTp1R);
  });

  it("accepts executable scalp geometry", () => {
    const result = validateTradeSetup({
      currentPrice: 3984,
      dataSufficient: true,
      trade: {
        action: "sell",
        entry: 3984,
        stop_loss: 3986,
        targets: [3978.5, 3974],
      },
      spread: 0.05,
      activationClass: "immediate",
    });
    assert.equal(result.accepted, true);
    assert.ok((result.netRr ?? 0) >= SCALP_GEOMETRY.minNetTp1R);
  });
});

describe("path-to-entry analysis", () => {
  it("does not invent a transitional buy merely because sell entry is above", () => {
    const path = analyzePathToEntry({
      action: "sell",
      currentPrice: 3975.26,
      entry: 3981.675,
      atr: 1.5,
      independentTransitionEvidence: false,
      zoneAlreadyBroken: false,
      driftingAway: false,
    });
    assert.equal(path.class, "neutral_path");
    assert.equal(path.transitionalTradeJustified, false);
  });

  it("requires independent evidence for a transitional trade", () => {
    const path = analyzePathToEntry({
      action: "sell",
      currentPrice: 3975.26,
      entry: 3981.675,
      atr: 1.5,
      independentTransitionEvidence: true,
      zoneAlreadyBroken: false,
      driftingAway: false,
    });
    assert.equal(path.transitionalTradeJustified, true);
    assert.equal(path.class, "continuation_edge");
  });
});
