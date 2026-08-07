import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRADABILITY_LIMITS,
  assessTradability,
} from "@/lib/recommendations/tradability";

describe("tradability budget — the reported far-entry case", () => {
  it("rejects the 'excellent sell entry, price far below' recommendation", () => {
    // The complaint that motivated the gate: sell plan whose entry sits
    // ~4.3 ATR above the market. Today this stores and renders as a normal
    // conditional recommendation; the budget refuses to publish it as a trade.
    const verdict = assessTradability({
      direction: "sell",
      planType: "conditional",
      entry: 3981.675,
      currentPrice: 3975.26,
      atr: 1.5,
      validityCandles: 12,
    });
    assert.equal(verdict.tradability, "rejected");
    assert.ok(verdict.reasons.includes("entry_too_far_to_publish"));
    assert.ok((verdict.entryDistanceAtr ?? 0) > TRADABILITY_LIMITS.maxPublishableAtr);
  });

  it("keeps a genuinely near conditional plan publishable as `soon`", () => {
    const verdict = assessTradability({
      direction: "sell",
      planType: "conditional",
      entry: 3976.9, // ~1.1 ATR away
      currentPrice: 3975.26,
      atr: 1.5,
      validityCandles: 12,
    });
    assert.equal(verdict.tradability, "soon");
    assert.equal(verdict.priceKnown, true);
    assert.ok((verdict.expectedBarsToActivation ?? 99) <= 12);
  });

  it("an at-market entry is `now` with zero bars to activation", () => {
    const verdict = assessTradability({
      direction: "buy",
      planType: "immediate",
      entry: 3975.4,
      currentPrice: 3975.26,
      atr: 1.5,
    });
    assert.equal(verdict.tradability, "now");
    assert.equal(verdict.expectedBarsToActivation, 0);
  });
});

describe("tradability boundaries", () => {
  const base = { direction: "buy" as const, currentPrice: 100, atr: 1 };

  it("grades exactly on the ATR boundaries", () => {
    assert.equal(
      assessTradability({ ...base, entry: 100 + TRADABILITY_LIMITS.nowMaxAtr }).tradability,
      "now",
    );
    assert.equal(
      assessTradability({ ...base, entry: 100 + TRADABILITY_LIMITS.nowMaxAtr + 0.01 })
        .tradability,
      "soon",
    );
    assert.equal(
      assessTradability({ ...base, entry: 100 + TRADABILITY_LIMITS.soonMaxAtr }).tradability,
      "soon",
    );
    assert.equal(
      assessTradability({ ...base, entry: 100 + TRADABILITY_LIMITS.soonMaxAtr + 0.01 })
        .tradability,
      "watch_only",
    );
    assert.equal(
      assessTradability({ ...base, entry: 100 + TRADABILITY_LIMITS.maxPublishableAtr })
        .tradability,
      "watch_only",
    );
    assert.equal(
      assessTradability({
        ...base,
        entry: 100 + TRADABILITY_LIMITS.maxPublishableAtr + 0.01,
      }).tradability,
      "rejected",
    );
  });

  it("a `soon` distance that cannot activate inside validity becomes watch_only", () => {
    // 1.4 ATR away → optimistic estimate ceil(1.4 × 2) = 3 bars. validity 2.
    const verdict = assessTradability({
      ...base,
      entry: 101.4,
      validityCandles: 2,
    });
    assert.equal(verdict.tradability, "watch_only");
    assert.ok(verdict.reasons.includes("activation_unlikely_within_validity"));
  });

  it("the same distance with room in the validity window stays `soon`", () => {
    const verdict = assessTradability({
      ...base,
      entry: 101.4,
      validityCandles: 8,
    });
    assert.equal(verdict.tradability, "soon");
  });

  it("distance within one spread is at-market regardless of ATR grading", () => {
    const verdict = assessTradability({
      ...base,
      entry: 100.5, // 0.5 ATR — would grade `soon`…
      spread: 0.6, // …but the spread swallows the distance.
    });
    assert.equal(verdict.tradability, "now");
    assert.ok(verdict.reasons.includes("within_spread_noise"));
  });

  it("an immediate plan away from market carries the named contradiction", () => {
    const verdict = assessTradability({
      ...base,
      planType: "immediate",
      entry: 101.2,
    });
    assert.equal(verdict.tradability, "soon");
    assert.ok(verdict.reasons.includes("immediate_plan_but_entry_not_at_market"));
  });
});

describe("tradability fail-safe paths", () => {
  it("no ATR: near fraction grades, far fraction still rejects", () => {
    const near = assessTradability({
      direction: "buy",
      entry: 100.04,
      currentPrice: 100,
      atr: null,
    });
    assert.equal(near.tradability, "now");
    assert.equal(near.entryDistanceAtr, null);

    const mid = assessTradability({
      direction: "buy",
      entry: 100.3,
      currentPrice: 100,
      atr: null,
    });
    assert.equal(mid.tradability, "soon");
    assert.ok(mid.reasons.includes("atr_unavailable"));

    const far = assessTradability({
      direction: "sell",
      entry: 102, // 2% away with no volatility context
      currentPrice: 100,
      atr: null,
    });
    assert.equal(far.tradability, "rejected");
    assert.equal(far.expectedBarsToActivation, null);
  });

  it("unreadable price fails safe to watch_only, never to rejected", () => {
    const verdict = assessTradability({
      direction: "buy",
      entry: 100,
      currentPrice: null,
      atr: 1,
    });
    assert.equal(verdict.tradability, "watch_only");
    assert.equal(verdict.priceKnown, false);
    assert.ok(verdict.reasons.includes("price_unavailable"));
  });

  it("non-directional input is not graded", () => {
    const verdict = assessTradability({
      direction: "wait",
      entry: 100,
      currentPrice: 100,
    });
    assert.equal(verdict.tradability, "watch_only");
    assert.ok(verdict.reasons.includes("direction_not_gradable"));
  });
});
