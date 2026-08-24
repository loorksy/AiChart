import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { revalidatePlan, WAITING_MAX_ATR_DISTANCE } from "../revalidation";

/**
 * The live incident, as it was actually configured.
 *
 * The reported limit was 2.67 — which is 8.9 ATR × 0.3, the MARKET tolerance.
 * So the plan that died was graded as fill-now, and that is the fixture: a
 * waiting plan at the same distance is a different (and now passing) case,
 * pinned separately below.
 */
const buy = {
  direction: "buy" as const,
  effectiveEntry: 4628.9,
  stopLoss: 4614.5,
  targets: [4639.82, 4673.77],
  atr: 8.9,
  entryType: "market",
};

describe("live revalidation: re-price, do not refuse", () => {
  it("re-prices to the live price instead of refusing when price outran the entry", () => {
    // 2026-08-24: distance 21.30 against a 2.67 limit vetoed this exact plan,
    // and the operator was told there was no trade. There was a trade — just
    // not at that price.
    const verdict = revalidatePlan({ ...buy, currentPrice: 4650.2 });
    assert.equal(verdict.status, "reanchored");
    assert.equal(verdict.reanchoredEntry, 4650.2);
  });

  it("leaves the SAME distance alone when the plan was written to wait", () => {
    // A waiting plan gets the 4-ATR budget (35.60), so 21.30 is the ordinary
    // pullback it was written to catch — nothing to re-price.
    const waiting = { ...buy, entryType: "confirmation_close" };
    assert.equal(revalidatePlan({ ...waiting, currentPrice: 4650.2 }).status, "ok");
  });

  it("keeps the structural stop when it re-prices — the idea did not move", () => {
    const verdict = revalidatePlan({ ...buy, currentPrice: 4650.2 });
    // Reward:risk is measured from the CHASED entry against the ORIGINAL stop,
    // so it comes out worse. That is the true cost of chasing and the number
    // the operator is shown.
    const risk = 4650.2 - buy.stopLoss;
    const reward = buy.targets[0]! - 4650.2;
    assert.ok(verdict.liveRr != null);
    assert.ok(Math.abs(verdict.liveRr - reward / risk) < 1e-9);
    assert.ok(verdict.liveRr < 1, "chasing this far buys a worse ratio, and says so");
  });

  it("names both prices in the reason, so the entry shown is never silently swapped", () => {
    const verdict = revalidatePlan({ ...buy, currentPrice: 4650.2, plannedRr: 3.1 });
    assert.match(verdict.reasonAr ?? "", /4628\.90/);
    assert.match(verdict.reasonAr ?? "", /4650\.20/);
  });

  it("still passes untouched when price sits within tolerance", () => {
    const verdict = revalidatePlan({ ...buy, currentPrice: 4630.0 });
    assert.equal(verdict.status, "ok");
    assert.equal(verdict.reanchoredEntry, undefined);
  });

  it("lets a waiting plan sit its full ATR budget away without re-pricing", () => {
    const waiting = { ...buy, entryType: "confirmation_close" };
    const justInside = buy.effectiveEntry + buy.atr * WAITING_MAX_ATR_DISTANCE - 0.01;
    assert.equal(revalidatePlan({ ...waiting, currentPrice: justInside }).status, "ok");
  });
});

describe("what re-pricing must NOT do", () => {
  it("refuses a plan whose stop price has already been reached", () => {
    // The hole this replaced: `movedPast` only fires when price travels AWAY
    // from the entry, and the platform sets no minRr, so a buy that fell
    // straight through its own stop passed G7 with status "ok".
    const verdict = revalidatePlan({ ...buy, currentPrice: 4610.0 });
    assert.equal(verdict.status, "invalidated");
    assert.equal(verdict.reanchoredEntry, undefined);
  });

  it("treats touching the stop exactly as breached, not as a near miss", () => {
    assert.equal(
      revalidatePlan({ ...buy, currentPrice: buy.stopLoss }).status,
      "invalidated",
    );
  });

  it("catches the same breach on a sell, where it is the HIGH side", () => {
    const verdict = revalidatePlan({
      direction: "sell",
      effectiveEntry: 4650.44,
      stopLoss: 4662.72,
      targets: [4638.1],
      atr: 8.9,
      entryType: "limit_touch",
      currentPrice: 4665.0,
    });
    assert.equal(verdict.status, "invalidated");
  });

  it("refuses when every target is already behind price", () => {
    // Re-pricing here would open a trade with its whole reward spent.
    const verdict = revalidatePlan({ ...buy, currentPrice: 4680.0 });
    assert.equal(verdict.status, "targets_passed");
    assert.equal(verdict.reanchoredEntry, undefined);
  });

  it("re-prices while ANY target still stands, even past the first", () => {
    // 4645 is past target 1 (4639.82) but short of target 2 (4673.77).
    const verdict = revalidatePlan({ ...buy, currentPrice: 4645.0 });
    assert.equal(verdict.status, "reanchored");
  });

  it("checks the stop before anything else — a dead idea is never re-priced", () => {
    // Contrived so both a breach and a large distance are true at once.
    const verdict = revalidatePlan({
      ...buy,
      targets: [4700],
      currentPrice: 4600.0,
    });
    assert.equal(verdict.status, "invalidated");
  });
});

describe("a sell mirrors the buy exactly", () => {
  const sell = {
    direction: "sell" as const,
    effectiveEntry: 4650.44,
    stopLoss: 4662.72,
    targets: [4638.1, 4625.5],
    atr: 8.9,
    entryType: "confirmation_close",
  };

  it("leaves a drop inside the waiting budget alone", () => {
    // 20.44 away, against a 4-ATR budget of 35.60: this is the pullback the
    // plan was written to catch, not drift.
    assert.equal(revalidatePlan({ ...sell, currentPrice: 4630.0 }).status, "ok");
  });

  it("re-prices a drop that outran the budget while a target still stands", () => {
    const far = { ...sell, targets: [4638.1, 4600.0] };
    const verdict = revalidatePlan({ ...far, currentPrice: 4610.0 });
    assert.equal(verdict.status, "reanchored");
    assert.equal(verdict.reanchoredEntry, 4610.0);
  });

  it("prefers targets_passed over re-pricing when the drop cleared them all", () => {
    // Same 4610 quote, but with the original close targets there is nothing
    // left to make — so the plan is refused rather than chased.
    assert.equal(
      revalidatePlan({ ...sell, currentPrice: 4610.0 }).status,
      "targets_passed",
    );
  });

  it("keeps an explicit RR floor working for callers that opt into one", () => {
    const verdict = revalidatePlan({ ...sell, currentPrice: 4650.0, minRr: 5 });
    assert.equal(verdict.status, "rr_degraded");
  });
});
