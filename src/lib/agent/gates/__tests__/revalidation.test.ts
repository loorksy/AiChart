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
    // A MARKET sell: it fills at the live quote, so a quote at/past the stop
    // means the position would open already lost. (The same numbers on a
    // WAITING sell are legitimate approach geometry — pinned below.)
    const verdict = revalidatePlan({
      direction: "sell",
      effectiveEntry: 4650.44,
      stopLoss: 4662.72,
      targets: [4638.1],
      atr: 8.9,
      entryType: "market",
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

describe("waiting plans: the stop is the FILL's geometry, not the approach path", () => {
  // The 2026-08-26 production refusal, in its own numbers: a conditional
  // XAUUSD breakdown sell — entry 4605.29 below the market, stop 4608.13 just
  // above the entry, live price ~4613 above BOTH. The old check compared the
  // live price against the stop for every plan and read this as "the stop is
  // already hit", so the operator got «السعر بلغ وقف الخسارة 4608.13 أو
  // تجاوزه» and an empty card — for exactly the shape every breakdown plan is
  // born with. The market sitting above a pending sell's stop is the
  // APPROACH; the stop only starts existing when the fill does (the tracker
  // evaluates SL strictly after activation).
  const pendingSell = {
    direction: "sell" as const,
    effectiveEntry: 4605.29,
    stopLoss: 4608.13,
    targets: [4595.0, 4586.0],
    atr: 8.9,
    entryType: "confirmation_close",
  };

  it("passes the production geometry that was refused as 'stop already hit'", () => {
    const verdict = revalidatePlan({ ...pendingSell, currentPrice: 4613.0 });
    assert.equal(verdict.status, "ok");
  });

  it("passes the same geometry on a limit_touch fill", () => {
    const verdict = revalidatePlan({
      ...pendingSell,
      entryType: "limit_touch",
      currentPrice: 4613.0,
    });
    assert.equal(verdict.status, "ok");
  });

  it("mirrors for a pending BUY above a breakout level", () => {
    // Buy the breakout at 4620, stop 4615 below the entry, market still at
    // 4610: the live price sits below the stop by construction while the
    // plan waits for the break.
    const verdict = revalidatePlan({
      direction: "buy",
      effectiveEntry: 4620.0,
      stopLoss: 4615.0,
      targets: [4632.0, 4645.0],
      atr: 8.9,
      entryType: "confirmation_close",
      currentPrice: 4610.0,
    });
    assert.equal(verdict.status, "ok");
  });

  it("lets a pullback buy keep a target behind the LIVE price — it fills below", () => {
    // Buy the dip at 4600, ride back to 4610. Market now 4613: the target is
    // behind the live price and in front of the ENTRY — a legitimate waiting
    // plan, not a move already spent.
    const verdict = revalidatePlan({
      direction: "buy",
      effectiveEntry: 4600.0,
      stopLoss: 4594.0,
      targets: [4610.0],
      atr: 8.9,
      entryType: "limit_touch",
      currentPrice: 4613.0,
    });
    assert.equal(verdict.status, "ok");
  });

  it("still refuses geometry broken against the plan's OWN entry", () => {
    // Stop below a sell entry: the fill would be born stopped out. G6 refuses
    // this first; held here too so no caller can skip coherence and slip a
    // self-losing fill past G7.
    const verdict = revalidatePlan({
      ...pendingSell,
      stopLoss: 4600.0,
      currentPrice: 4613.0,
    });
    assert.equal(verdict.status, "invalidated");
  });

  it("never re-anchors a left-behind waiting plan into a fill with its reward spent", () => {
    // A pending buy whose market ran up beyond the waiting budget AND past
    // every target: re-pricing to the live quote would open a trade that
    // cannot win, so the stale fact is reported instead (the orchestrator's
    // reprice loop feeds it back for a freshly-priced plan).
    const verdict = revalidatePlan({
      direction: "buy",
      effectiveEntry: 4600.0,
      stopLoss: 4594.0,
      targets: [4630.0],
      atr: 8.9,
      entryType: "limit_touch",
      currentPrice: 4640.0,
    });
    assert.equal(verdict.status, "targets_passed");
    assert.equal(verdict.reanchoredEntry, undefined);
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
