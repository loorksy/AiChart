import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRecommendationExpiry } from "@/lib/agent/recommendationExpiry";
import { spanStyleForInterval } from "@/lib/agent/trading/scalpGeometry";
import { resolveValidity } from "@/lib/agent/trading/tradePlan";

describe("recommendation expiry ceilings", () => {
  const from = Date.parse("2026-01-01T00:00:00.000Z");

  it("treats 1m/5m as scalp (30m) and longer frames by interval", () => {
    assert.equal(spanStyleForInterval("1m"), "scalp");
    assert.equal(spanStyleForInterval("5m"), "scalp");
    assert.equal(spanStyleForInterval("15m"), "intraday");
    assert.equal(spanStyleForInterval("1h"), "swing");

    assert.equal(
      computeRecommendationExpiry({ interval: "1m", scalp: true, from }),
      from + 30 * 60_000,
    );
    assert.equal(
      computeRecommendationExpiry({ interval: "15m", scalp: false, from }),
      from + 3 * 60 * 60_000,
    );
    assert.equal(
      computeRecommendationExpiry({ interval: "1h", scalp: false, from }),
      from + 36 * 60 * 60_000,
    );
  });

  it("resolveValidity never exceeds the timeframe ceiling (no silent scalp:true)", () => {
    const interval = "1h";
    const maxExpiresAt = computeRecommendationExpiry({
      interval,
      scalp: spanStyleForInterval(interval) === "scalp",
      from,
    });
    const { expiresAt } = resolveValidity({
      validityCandles: 96,
      interval,
      maxExpiresAt,
      now: from,
    });
    assert.equal(expiresAt, maxExpiresAt);
    assert.ok(expiresAt - from <= 36 * 60 * 60_000);
  });
});
