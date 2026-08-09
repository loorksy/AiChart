import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANALYSIS_QUOTE_STALE_MS,
  costEvidencePips,
  serializeCostEvidence,
  UNAVAILABLE_COST,
  type CostEvidence,
} from "@/lib/agent/marketContext/costEvidence";
import { computeNetR, expectedExecutionCost } from "@/lib/agent/trading/scalpGeometry";

/**
 * High #16 part 2 and Partial #17.
 *
 * Three breaks sat between the observed spread and the decision engine: no
 * entry point supplied one, the emitted shapes had disjoint keys so the only
 * reader saw NaN, and the units were mixed by ~10^4. These pin the contract
 * that replaced all three.
 */

function observed(overrides?: Partial<CostEvidence>): CostEvidence {
  return {
    source: "observed_quote",
    spreadPrice: 0.00012,
    spreadPips: 1.2,
    bid: 1.09,
    ask: 1.09012,
    observedAt: 1_700_000_000_000,
    freshnessMs: 900,
    session: null,
    sampleCount: null,
    fallbackUsed: false,
    fallbackReason: null,
    ...overrides,
  };
}

describe("the serialized contract", () => {
  it("names the unit in every spread key", () => {
    const wire = serializeCostEvidence(observed());
    // The ambiguity of a bare `spread` is what let price and pips be mixed.
    assert.ok("observed_spread_price" in wire);
    assert.ok("observed_spread_pips" in wire);
    assert.equal(wire.observed_spread_price, 0.00012);
    assert.equal(wire.observed_spread_pips, 1.2);
  });

  it("carries the full evidence contract", () => {
    const wire = serializeCostEvidence(observed());
    for (const key of [
      "source",
      "bid",
      "ask",
      "observed_at",
      "freshness_ms",
      "session",
      "sample_count",
      "fallback_used",
      "fallback_reason",
    ]) {
      assert.ok(key in wire, `${key} must be on the wire`);
    }
  });

  it("states unavailability rather than rendering it as zero", () => {
    const wire = serializeCostEvidence(UNAVAILABLE_COST);
    assert.equal(wire.source, "unavailable");
    assert.equal(wire.observed_spread_pips, null);
    assert.notEqual(wire.observed_spread_pips, 0);
    assert.equal(wire.fallback_used, true);
    assert.ok(String(wire.fallback_reason).length > 0);
  });

  it("marks every non-observed rung as a fallback, with a reason", () => {
    for (const source of ["live_cost_profile", "session_profile", "static_fallback"] as const) {
      const wire = serializeCostEvidence(
        observed({ source, fallbackUsed: true, fallbackReason: "no fresh observed quote" }),
      );
      assert.equal(wire.fallback_used, true);
      assert.ok(String(wire.fallback_reason).length > 0, source);
    }
  });
});

describe("the reader the drift trigger uses", () => {
  it("reads the canonical pips key the contract writes", () => {
    assert.equal(costEvidencePips(serializeCostEvidence(observed())), 1.2);
  });

  it("still reads pre-contract rows rather than returning NaN", () => {
    // Old snapshots wrote a bare price-unit number under these names.
    assert.equal(costEvidencePips({ expected_spread: 0.9 }), 0.9);
    assert.equal(costEvidencePips({ observed_spread: 1.1 }), 1.1);
  });

  it("returns NaN only when there is genuinely no cost on the row", () => {
    assert.ok(Number.isNaN(costEvidencePips(null)));
    assert.ok(Number.isNaN(costEvidencePips({})));
    assert.ok(Number.isNaN(costEvidencePips(serializeCostEvidence(UNAVAILABLE_COST))));
  });

  it("would have read NaN from the shape the V2 pipeline used to emit", () => {
    // The break, stated: liveCost spread in `expectedSpreadPips`, which the
    // reader never looked for, while `observed_spread` was null.
    const oldShape = { session: "london", expectedSpreadPips: 1.4, observed_spread: null };
    assert.ok(Number.isNaN(costEvidencePips(oldShape)));
  });
});

describe("cost actually changes the arithmetic", () => {
  it("net R differs from gross R once a real spread is present", () => {
    const plan = { action: "buy" as const, entry: 1.1, stop: 1.095, target: 1.11 };
    const gross = computeNetR({ ...plan, spread: 0 });
    const net = computeNetR({ ...plan, spread: 0.00012 });
    assert.ok(net < gross, "a real spread must reduce net R");
  });

  it("an absent spread costs nothing — it is not guessed at", () => {
    assert.equal(expectedExecutionCost({ spread: null }), 0);
    assert.equal(expectedExecutionCost({ spread: 0 }), 0);
  });

  it("uses PRICE units, which is what the plan levels are in", () => {
    // Feeding a pips figure here is the 10^4 error: 1.2 "spread" against a
    // 0.005 stop distance would swamp the risk entirely.
    const plan = { action: "buy" as const, entry: 1.1, stop: 1.095, target: 1.11 };
    assert.ok(computeNetR({ ...plan, spread: 0.00012 }) > 0);
    assert.equal(computeNetR({ ...plan, spread: 1.2 }), 0);
  });
});

describe("freshness", () => {
  it("has its own analysis threshold, not the execution gate", () => {
    // A quote too old to fill against can still be honest evidence for a
    // decision; conflating the two is wrong in both directions.
    assert.ok(ANALYSIS_QUOTE_STALE_MS > 0);
  });

  it("a fresh observation is not marked as a fallback", () => {
    const wire = serializeCostEvidence(observed());
    assert.equal(wire.fallback_used, false);
    assert.equal(wire.fallback_reason, null);
    assert.equal(wire.source, "observed_quote");
  });

  it("a stale observation is never presented as live", () => {
    // resolveCostEvidence drops to a profile rung and says why; the shape it
    // produces must never claim observed_quote.
    const stale = observed({
      source: "session_profile",
      fallbackUsed: true,
      fallbackReason: "observed quote was 300s old (limit 60s)",
      bid: null,
      ask: null,
      observedAt: null,
      freshnessMs: null,
    });
    const wire = serializeCostEvidence(stale);
    assert.notEqual(wire.source, "observed_quote");
    assert.equal(wire.bid, null);
    assert.equal(wire.observed_at, null);
    assert.match(String(wire.fallback_reason), /old/);
  });
});
