import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  buildEaLiveQuotesSummary,
  clearEaLiveQuotesForTests,
  updateEaLiveQuotes,
} from "@/lib/eaLiveState";

describe("ea live quotes freshness", () => {
  it("sorts fresh symbols first and exposes spread metadata", async () => {
    const userId = 99_003;
    clearEaLiveQuotesForTests(userId);
    const t0 = 1_700_000_000_000;
    mock.timers.enable({ apis: ["Date"], now: t0 });

    await updateEaLiveQuotes(userId, [
      { symbol: "EURUSD", bid: 1.08, ask: 1.0802 },
    ]);
    mock.timers.setTime(t0 + 10_000);
    await updateEaLiveQuotes(userId, [
      { symbol: "GBPUSD", bid: 1.26, ask: 1.2603 },
    ]);

    const summary = await buildEaLiveQuotesSummary(userId);
    assert.equal(summary.count, 2);
    assert.equal(summary.staleThresholdMs, 5000);
    assert.equal(summary.freshCount, 1);
    assert.equal(summary.staleCount, 1);
    assert.deepEqual(summary.freshSymbols, ["GBPUSD"]);

    assert.equal(summary.quotes[0]!.symbol, "GBPUSD");
    assert.equal(summary.quotes[0]!.isFresh, true);
    assert.equal(summary.quotes[0]!.source, "live");

    const stale = summary.quotes.find((q) => q.symbol === "EURUSD");
    assert.ok(stale);
    assert.equal(stale.isFresh, false);
    assert.equal(stale.source, "stale");
    assert.ok(stale.spreadPips != null && stale.spreadPips > 0);

    mock.timers.reset();
    clearEaLiveQuotesForTests(userId);
  });
});
