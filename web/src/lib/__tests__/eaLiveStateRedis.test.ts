import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  clearEaLiveQuotesForTests,
  getEaLiveQuote,
  updateEaLiveQuotes,
} from "@/lib/eaLiveState";
import { resetBridgeKvStoreForTests } from "@/lib/bridge/store";

describe("eaLiveState redis hydration", () => {
  afterEach(() => {
    clearEaLiveQuotesForTests();
    resetBridgeKvStoreForTests();
    delete process.env.REDIS_URL;
  });

  it("hydrates quotes from KV store when memory is empty", async () => {
    const userId = 88_001;
    await updateEaLiveQuotes(userId, [
      { symbol: "EURUSD", bid: 1.085, ask: 1.0852 },
    ]);

    clearEaLiveQuotesForTests(userId);

    const quote = await getEaLiveQuote(userId, "EURUSD");
    assert.ok(quote);
    assert.equal(quote.bid, 1.085);
    assert.equal(quote.ask, 1.0852);
    assert.ok(quote.quoteAgeMs >= 0);
  });
});
