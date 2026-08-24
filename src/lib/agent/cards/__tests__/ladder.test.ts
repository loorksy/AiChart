import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildLadder } from "../ladder";

const at = (g: ReturnType<typeof buildLadder>, role: string) =>
  g.rungs.find((r) => r.role === role)!;

describe("the price ladder", () => {
  it("puts a buy's targets above its entry and its stop below", () => {
    const g = buildLadder({ entry: 4628.9, stopLoss: 4614.5, targets: [4639.82, 4673.77] });
    assert.ok(at(g, "stop").pos < at(g, "entry").pos);
    const targets = g.rungs.filter((r) => r.role === "target");
    for (const target of targets) assert.ok(target.pos > at(g, "entry").pos);
  });

  it("puts a sell's targets BELOW its entry and its stop above — same code path", () => {
    // The orientation is not passed in and not branched on. If this passes
    // for both sides, no direction flag can ever be threaded through wrong.
    const g = buildLadder({ entry: 4650.44, stopLoss: 4662.72, targets: [4638.1, 4625.5] });
    assert.ok(at(g, "stop").pos > at(g, "entry").pos);
    for (const target of g.rungs.filter((r) => r.role === "target")) {
      assert.ok(target.pos < at(g, "entry").pos);
    }
  });

  it("anchors the extremes at 0 and 1", () => {
    const g = buildLadder({ entry: 100, stopLoss: 90, targets: [130] });
    assert.equal(at(g, "stop").pos, 0);
    assert.equal(g.rungs.find((r) => r.role === "target")!.pos, 1);
  });

  it("measures reward:risk from the stop distance, per target", () => {
    // risk = 10; targets at +10 and +25 are therefore 1R and 2.5R.
    const g = buildLadder({ entry: 100, stopLoss: 90, targets: [110, 125] });
    const targets = g.rungs.filter((r) => r.role === "target");
    assert.equal(targets[0]!.rr, 1);
    assert.equal(targets[1]!.rr, 2.5);
  });

  it("reports no reward:risk at all when there is no risk to divide by", () => {
    // Infinity would render as "∞R" and read like a spectacular trade.
    const g = buildLadder({ entry: 100, stopLoss: 100, targets: [110] });
    assert.equal(g.rungs.find((r) => r.role === "target")!.rr, undefined);
  });

  it("spans the risk band between entry and stop, and reward to the FURTHEST target", () => {
    const g = buildLadder({ entry: 100, stopLoss: 90, targets: [110, 130, 120] });
    assert.equal(g.riskBand.from, at(g, "entry").pos);
    assert.equal(g.riskBand.to, at(g, "stop").pos);
    // 130 is furthest from entry even though 120 comes after it in the array.
    assert.equal(g.rewardBand.to, 1);
  });

  it("places the live price on the same axis, without disturbing the plan", () => {
    // The live price is the reason a plan gets refused for being unreachable,
    // so it has to be visible in the same picture as the entry it ran past.
    const g = buildLadder({
      entry: 4628.9,
      stopLoss: 4614.5,
      targets: [4639.82],
      livePrice: 4650.2,
    });
    const live = at(g, "live");
    assert.equal(live.pos, 1, "a live price beyond every level tops the axis");
    assert.ok(live.pos > at(g, "entry").pos);
  });

  it("centres everything rather than dividing by zero when all levels coincide", () => {
    const g = buildLadder({ entry: 100, stopLoss: 100, targets: [100] });
    for (const rung of g.rungs) assert.equal(rung.pos, 0.5);
    for (const rung of g.rungs) assert.ok(Number.isFinite(rung.pos));
  });

  it("drops a non-finite target instead of collapsing the whole axis to NaN", () => {
    const g = buildLadder({ entry: 100, stopLoss: 90, targets: [110, Number.NaN] });
    assert.equal(g.rungs.filter((r) => r.role === "target").length, 1);
    for (const rung of g.rungs) assert.ok(Number.isFinite(rung.pos));
  });
});
